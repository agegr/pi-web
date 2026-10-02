import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-route-")));
const agentDir = join(root, "agent");
const workspace = join(root, "workspace");
const cwd = join(workspace, "project");
const outside = join(root, "outside");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousDisable = process.env.PI_WEB_DISABLE_MCP;
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_DISABLE_MCP;
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, ".pi"), { recursive: true });
await mkdir(outside, { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET } = await jiti.import("./route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousDisable === undefined) delete process.env.PI_WEB_DISABLE_MCP;
  else process.env.PI_WEB_DISABLE_MCP = previousDisable;
  await rm(root, { recursive: true, force: true });
});

const marker = join(root, "command-ran");
const globalPath = join(agentDir, "mcp.json");
const projectPath = join(cwd, ".pi", "mcp.json");
const settingsPath = join(agentDir, "settings.json");

await writeFile(globalPath, JSON.stringify({
  mcpServers: {
    docs: { url: "https://docs.example.com/mcp" },
    shared: { command: "global-shared" },
  },
}));
await writeFile(projectPath, JSON.stringify({
  mcpServers: {
    repo: { command: "node", args: ["server.js"], env: { TOKEN: `!touch ${marker}`, KEY: "literal-project-secret" } },
    shared: { command: "project-shared" },
  },
}));

async function get(query = "") {
  const response = await GET(new Request(`http://localhost/api/mcp${query}`, { headers: { host: "localhost" } }));
  return { status: response.status, body: await response.json() };
}

function forCwd(path = cwd) {
  return `?cwd=${encodeURIComponent(path)}`;
}

test("without a cwd only the global file is listed", async () => {
  const { status, body } = await get();
  assert.equal(status, 200);
  assert.deepEqual(body.mcp, { available: true });
  assert.deepEqual(body.files.map((file) => [file.scope, file.path]), [["global", globalPath]]);
  assert.deepEqual(body.servers.map((server) => server.name), ["docs", "shared"]);
  assert.equal(body.project, undefined);
});

test("an untrusted project is listed with the command each entry would run, and nothing runs", async () => {
  const { status, body } = await get(forCwd());
  assert.equal(status, 200);
  assert.equal(body.project.cwd, cwd);
  assert.deepEqual(body.project.trust, { requiresTrust: true, trusted: false, decision: null, inherited: false });
  const repo = body.servers.find((server) => server.scope === "project" && server.name === "repo");
  assert.equal(repo.command, "node");
  assert.deepEqual(repo.args, ["server.js"]);
  assert.deepEqual(repo.envNames, ["TOKEN", "KEY"]);
  assert.deepEqual(repo.commandFields, [{ kind: "env", name: "TOKEN" }]);
  assert.equal(body.servers.find((server) => server.scope === "global" && server.name === "shared").shadowedByProject, true);
  assert.ok(!JSON.stringify(body).includes("literal-project-secret"));
  assert.equal(existsSync(marker), false, "the !command never ran");
  // Reading the OAuth state never goes through the SDK's store, which creates the file and a lock.
  assert.deepEqual((await readdir(agentDir)).sort(), ["mcp.json"]);
});

test("the project's trust is read fresh, exact or inherited", async (t) => {
  const store = new ProjectTrustStore(agentDir);
  t.after(() => {
    store.set(cwd, null);
    store.set(workspace, null);
  });
  store.set(cwd, true);
  assert.deepEqual((await get(forCwd())).body.project.trust, {
    requiresTrust: true,
    trusted: true,
    decision: true,
    decisionPath: cwd,
    inherited: false,
  });
  store.set(cwd, null);
  store.set(workspace, true);
  assert.deepEqual((await get(forCwd())).body.project.trust, {
    requiresTrust: true,
    trusted: true,
    decision: true,
    decisionPath: workspace,
    inherited: true,
  });
  store.set(cwd, false);
  assert.equal((await get(forCwd())).body.project.trust.trusted, false);
});

test("a cwd outside the allowed folders, relative, with .., or not a folder is refused", async () => {
  assert.deepEqual(await get(forCwd(outside)), { status: 403, body: { error: "Access denied", reason: "cwd-denied" } });
  assert.deepEqual(await get(forCwd(`${cwd}/../project`)), { status: 403, body: { error: "Access denied", reason: "cwd-denied" } });
  assert.deepEqual(await get("?cwd=project"), { status: 400, body: { error: "cwd must be an absolute path", reason: "cwd-invalid" } });
  assert.deepEqual(await get("?cwd="), { status: 400, body: { error: "cwd must be an absolute path", reason: "cwd-invalid" } });
  assert.deepEqual(await get(forCwd(projectPath)), { status: 400, body: { error: "cwd must be a directory", reason: "cwd-not-directory" } });
});

test("PI_WEB_DISABLE_MCP and -builtin:mcp turn MCP off with a reason, and the servers are still listed", async (t) => {
  t.after(async () => {
    delete process.env.PI_WEB_DISABLE_MCP;
    await rm(settingsPath, { force: true });
  });
  process.env.PI_WEB_DISABLE_MCP = "1";
  let { body } = await get();
  assert.deepEqual(body.mcp, { available: false, reason: "operator-disabled", error: "PI_WEB_DISABLE_MCP is set" });
  assert.deepEqual(body.servers.map((server) => server.name), ["docs", "shared"]);
  delete process.env.PI_WEB_DISABLE_MCP;

  await writeFile(settingsPath, JSON.stringify({ extensions: ["-builtin:mcp", "-builtin:codemode"] }));
  ({ body } = await get());
  assert.deepEqual(body.mcp, {
    available: false,
    reason: "builtin-disabled",
    error: "the extensions setting turns builtin:mcp off",
    settingsPath,
  });
  assert.equal(body.codemode.builtinDisabled, true);
  assert.equal(body.codemode.builtinSettingsPath, settingsPath);
  assert.equal(body.codemode.globalBuiltinSettingsPath, settingsPath);
});

test("Always on is weighed against the global extensions alone, whichever project the panel shows", async (t) => {
  const store = new ProjectTrustStore(agentDir);
  const projectSettings = join(cwd, ".pi", "settings.json");
  t.after(async () => {
    store.set(cwd, null);
    await rm(projectSettings, { force: true, recursive: true });
    await rm(settingsPath, { force: true });
  });
  store.set(cwd, true);
  const codemode = async (query) => {
    const { status, body } = await get(query);
    assert.equal(status, 200);
    return body.codemode;
  };

  // Only the trusted project turns Code mode off: its sessions lose it, the global settings do not.
  await writeFile(projectSettings, JSON.stringify({ extensions: ["-builtin:codemode"] }));
  let info = await codemode(forCwd());
  assert.equal(info.builtinDisabled, true);
  assert.equal(info.builtinSettingsPath, projectSettings);
  assert.equal(info.globalBuiltinSettingsPath, undefined);
  assert.equal((await codemode("")).builtinDisabled, false);

  // The global settings turn it off and the project turns it back on: the global answer is the same from either view.
  await writeFile(settingsPath, JSON.stringify({ extensions: ["-builtin:codemode"] }));
  await writeFile(projectSettings, JSON.stringify({ extensions: ["+builtin:codemode"] }));
  info = await codemode(forCwd());
  assert.equal(info.builtinDisabled, false);
  assert.equal(info.globalBuiltinSettingsPath, settingsPath);
  assert.equal((await codemode("")).globalBuiltinSettingsPath, settingsPath);

  if (process.platform !== "win32") {
    // A FIFO in a trusted project's settings answers at once, as if the file could not be read.
    await rm(projectSettings);
    execFileSync("mkfifo", [projectSettings]);
    info = await codemode(forCwd());
    assert.equal(info.builtinDisabled, false);
    assert.equal(info.projectOverride, undefined);
  }
});

test("Code mode reports the global preference and a self-test nobody has run yet", async (t) => {
  t.after(() => rm(settingsPath, { force: true }));
  let { body } = await get();
  assert.deepEqual(body.codemode, { sandbox: { state: "not-checked" }, builtinDisabled: false, preference: "automatic" });

  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  ({ body } = await get());
  assert.equal(body.codemode.preference, "always");

  await writeFile(settingsPath, "{ not json");
  const response = await get();
  assert.equal(response.status, 200, "an unreadable settings file does not fail the listing");
  assert.equal(response.body.codemode.preference, undefined);
  assert.match(response.body.codemode.preferenceError, /JSON/);
  assert.deepEqual(response.body.servers.map((server) => server.name), ["docs", "shared"]);
});

test("a trusted project whose own defaultTools decides Code mode there is reported, naming its settings", async (t) => {
  const store = new ProjectTrustStore(agentDir);
  const projectSettings = join(cwd, ".pi", "settings.json");
  t.after(async () => {
    store.set(cwd, null);
    store.set(workspace, null);
    await rm(projectSettings, { force: true });
    await rm(settingsPath, { force: true });
  });
  const codemode = async (query = forCwd()) => {
    const { status, body } = await get(query);
    assert.equal(status, 200);
    return body.codemode;
  };
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  // A plain list replaces the global one, +codemode and all.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["read", "bash"] }));
  // Not trusted: no session reads the project's settings, so nothing is reported.
  let info = await codemode();
  assert.equal(info.preference, "always");
  assert.equal(info.projectOverride, undefined);

  store.set(cwd, true);
  info = await codemode();
  assert.equal(info.preference, "always", "the global choice is still what the switch shows");
  assert.deepEqual(info.projectOverride, { settingsPath: projectSettings, preference: "automatic" });

  // A -codemode modifier is appended to the global list, and so has the last word.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["-codemode"] }));
  assert.deepEqual((await codemode()).projectOverride, { settingsPath: projectSettings, preference: "automatic" });

  // A project can turn it on too, whatever the global choice.
  await rm(settingsPath, { force: true });
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["read", "codemode"] }));
  info = await codemode();
  assert.equal(info.preference, "automatic");
  assert.deepEqual(info.projectOverride, { settingsPath: projectSettings, preference: "always" });
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["+codemode"] }));
  assert.deepEqual((await codemode()).projectOverride, { settingsPath: projectSettings, preference: "always" });

  // Modifiers that leave codemode alone keep the global choice in charge; so does a file pi reads as empty.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["+grep"], defaultModel: "m" }));
  assert.equal((await codemode()).projectOverride, undefined);
  await writeFile(projectSettings, "{ not json");
  assert.equal((await codemode()).projectOverride, undefined);

  // Trust through a parent counts, as it does when a session starts; without a cwd only the global file does.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["-codemode"] }));
  store.set(cwd, null);
  store.set(workspace, true);
  assert.deepEqual((await codemode()).projectOverride, { settingsPath: projectSettings, preference: "automatic" });
  assert.equal((await codemode("")).projectOverride, undefined);
  // An explicit false wins over the parent's trust.
  store.set(cwd, false);
  assert.equal((await codemode()).projectOverride, undefined);
});

test("what an open session reported is listed with its entry, and a session whose /mcp is another extension's is named", async (t) => {
  const { mcpConfigKey } = await jiti.import("../../../lib/mcp-config-key.ts");
  const { clearMcpStatuses, recordMcpHostInactive, recordMcpStatus } = await jiti.import("../../../lib/mcp-status.ts");
  t.after(clearMcpStatuses);
  const reported = { origin: "session", state: "conflict", conflict: "/ext/docs.ts", sessionId: "s1", cwd, updatedAt: 5 };
  recordMcpStatus({ scope: "global", sourcePath: globalPath, name: "docs" }, mcpConfigKey({ url: "https://docs.example.com/mcp" }), reported);
  const elsewhere = { owner: "/ext/elsewhere-mcp.ts", cwd: outside, updatedAt: 9 };
  recordMcpHostInactive("s2", elsewhere);

  const { body } = await get();
  assert.deepEqual(body.servers.find((server) => server.name === "docs").status, reported);
  // Without a project, the latest such session, which names its folder.
  assert.deepEqual(body.hostInactive, elsewhere);
  // With one, the session in that folder comes first.
  const here = { owner: "/ext/here-mcp.ts", cwd, updatedAt: 1 };
  recordMcpHostInactive("s3", here);
  assert.deepEqual((await get(forCwd())).body.hostInactive, here);

  clearMcpStatuses();
  const { body: cleared } = await get();
  assert.equal(cleared.hostInactive, undefined);
  assert.equal(cleared.servers.find((server) => server.name === "docs").status, undefined);
});
