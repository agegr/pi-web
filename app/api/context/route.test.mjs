import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-context-route-")));
const agentDir = join(root, "agent");
const workspace = join(root, "workspace");
const cwd = join(workspace, "project");
const other = join(root, "outside");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(join(cwd, ".pi"), { recursive: true });
await mkdir(agentDir, { recursive: true });
await mkdir(other, { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { trustProject } = await jiti.import("../../../lib/project-trust.ts");
const { GET, PUT } = await jiti.import("./route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

const agentAgents = join(agentDir, "AGENTS.md");
const localSystem = join(cwd, ".pi", "SYSTEM.md");
const localOverride = join(cwd, "AGENTS.override.md");

await writeFile(agentAgents, "global instructions\n");
await writeFile(localSystem, "project system prompt\n");
await writeFile(join(cwd, "AGENTS.md"), "project instructions\n");

async function get(query = "") {
  const response = await GET(new Request(`http://localhost/api/context${query}`, { headers: { host: "localhost" } }));
  return { status: response.status, body: await response.json() };
}

function put(body, headers = { "content-type": "application/json" }) {
  return PUT(new Request("http://localhost/api/context", {
    method: "PUT",
    headers: { host: "localhost", ...headers },
    body: JSON.stringify(body),
  }));
}

function forCwd(path = cwd) {
  return `?cwd=${encodeURIComponent(path)}`;
}

function fileOf(body, id) {
  return body.files.find((file) => file.id === id);
}

test("lists the seven entries with resolved paths and the discovered agent file", async () => {
  const { status, body } = await get(forCwd());

  assert.equal(status, 200);
  assert.equal(body.agentDir, agentDir);
  assert.equal(body.cwd, cwd);
  // The order is the panel's: the agent directory's three, then the project's four.
  assert.deepEqual(body.files.map((file) => file.id), [
    "agents-global", "system-global", "append-system-global",
    "agents-local", "system-local", "append-system-local", "agents-override-local",
  ]);
  assert.equal(fileOf(body, "agents-global").path, agentAgents);
  assert.equal(fileOf(body, "agents-global").content, "global instructions\n");
  assert.equal(fileOf(body, "system-local").content, "project system prompt\n");
  assert.equal(fileOf(body, "system-local").scope, "local");
  assert.equal(fileOf(body, "append-system-global").exists, false);
  assert.equal(fileOf(body, "agents-override-local").deletable, true);
  assert.equal(fileOf(body, "agents-local").deletable, false);
});

test("a project .pi file takes over the agent directory's once the project is trusted, and nothing is combined", async () => {
  // The folder already holds `.pi/SYSTEM.md`, which is itself what makes a
  // folder require trust, so no decision trusts it yet.
  const untrusted = await get(forCwd());
  assert.equal(fileOf(untrusted.body, "system-global").exists, false);
  assert.equal(fileOf(untrusted.body, "system-global").effective, false, "nothing is there to load");
  assert.equal(fileOf(untrusted.body, "system-local").effective, false);
  assert.equal(fileOf(untrusted.body, "system-local").requiresTrust, true);
  assert.equal(fileOf(untrusted.body, "system-local").content, "project system prompt\n",
    "the file is still listed and editable while it waits");

  await writeFile(join(agentDir, "SYSTEM.md"), "global system prompt\n");
  const waiting = await get(forCwd());
  assert.equal(fileOf(waiting.body, "system-global").effective, true,
    "the agent directory's file is what sessions read until the project is trusted");
  assert.equal(fileOf(waiting.body, "system-local").effective, false);

  trustProject(cwd, agentDir);
  const replaced = await get(forCwd());
  assert.equal(fileOf(replaced.body, "system-global").effective, false);
  assert.equal(fileOf(replaced.body, "system-global").shadowedBy, localSystem);
  assert.equal(fileOf(replaced.body, "system-global").content, "global system prompt\n",
    "the shadowed file is still listed and editable");
  assert.equal(fileOf(replaced.body, "system-local").effective, true);
  assert.equal(fileOf(replaced.body, "system-local").requiresTrust, undefined);

  await rm(join(agentDir, "SYSTEM.md"));
});

test("AGENTS.override.md replaces AGENTS.md in the same directory only", async () => {
  const before = await get(forCwd());
  assert.equal(fileOf(before.body, "agents-local").effective, true);
  assert.equal(fileOf(before.body, "agents-global").effective, true);

  await writeFile(localOverride, "# override\n");
  const after_ = await get(forCwd());
  assert.equal(fileOf(after_.body, "agents-local").effective, false);
  assert.equal(fileOf(after_.body, "agents-local").shadowedBy, localOverride);
  assert.equal(fileOf(after_.body, "agents-global").effective, true,
    "an override does not suppress the agent directory's context file");

  await rm(localOverride);
});

test("without a cwd the agent directory's entries are listed and the local ones are unset", async () => {
  const { status, body } = await get();

  assert.equal(status, 200);
  assert.equal(body.cwd, null);
  assert.equal(fileOf(body, "agents-global").path, agentAgents);
  assert.equal(fileOf(body, "agents-global").content, "global instructions\n");
  for (const id of ["agents-local", "system-local", "append-system-local", "agents-override-local"]) {
    assert.equal(fileOf(body, id).path, null, id);
    assert.equal(fileOf(body, id).exists, false, id);
  }
});

test("writes a file, creating it and its .pi folder, and answers the new listing", async () => {
  const response = await put({ id: "append-system-local", content: "appended\n", cwd });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(await readFile(join(cwd, ".pi", "APPEND_SYSTEM.md"), "utf8"), "appended\n");
  assert.equal(fileOf(body, "append-system-local").content, "appended\n");
});

test("creates an agent-directory file that does not exist yet", async () => {
  const response = await put({ id: "append-system-global", content: "global appended\n" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(fileOf(body, "append-system-global").path, join(agentDir, "APPEND_SYSTEM.md"));
  assert.equal(await readFile(join(agentDir, "APPEND_SYSTEM.md"), "utf8"), "global appended\n");
});

test("removes only the override, which exists to replace its siblings", async () => {
  await writeFile(localOverride, "# override\n");

  const refused = await put({ id: "agents-local", remove: true, cwd });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).reason, "invalid-request");
  assert.equal(await readFile(join(cwd, "AGENTS.md"), "utf8"), "project instructions\n");

  const removed = await put({ id: "agents-override-local", remove: true, cwd });
  const body = await removed.json();
  assert.equal(removed.status, 200);
  assert.equal(fileOf(body, "agents-override-local").exists, false);
  // Pi falls back to the file the override replaced.
  assert.equal(fileOf(body, "agents-local").effective, true);
  await assert.rejects(lstat(localOverride));
});

test("refuses an unknown id, a missing cwd for a local file, and a non-string body", async () => {
  const unknown = await put({ id: "settings-json", content: "x", cwd });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).reason, "invalid-request");

  const noCwd = await put({ id: "system-local", content: "x" });
  assert.equal(noCwd.status, 400);
  assert.equal((await noCwd.json()).reason, "cwd-invalid");

  const wrongType = await put({ id: "system-local", content: 42, cwd });
  assert.equal(wrongType.status, 400);
  assert.equal((await wrongType.json()).reason, "invalid-request");
});

test("refuses a request that is not JSON from this page", async () => {
  const notJson = await put({ id: "system-local", content: "x", cwd }, { "content-type": "text/plain" });
  assert.equal(notJson.status, 415);

  const crossSite = await PUT(new Request("http://localhost/api/context", {
    method: "PUT",
    headers: { host: "localhost", "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ id: "system-local", content: "x", cwd }),
  }));
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).reason, "request-denied");
});

test("refuses a project file whose .pi folder resolves outside the allowed roots", async () => {
  const linkDir = join(other, "pi");
  await mkdir(linkDir, { recursive: true });
  await writeFile(join(linkDir, "SYSTEM.md"), "escaped\n");
  const escape = join(root, "workspace", "escaped");
  await mkdir(escape, { recursive: true });
  await symlink(linkDir, join(escape, ".pi"));
  // Browsable, so the cwd check passes and the file's own link is what refuses it.
  allowFileRoot(escape);

  const listed = await get(forCwd(escape));
  assert.equal(listed.status, 200);
  assert.equal(fileOf(listed.body, "system-local").problem, "outside-roots");

  const written = await put({ id: "system-local", content: "x", cwd: escape });
  assert.equal(written.status, 403);
  assert.equal((await written.json()).reason, "link-outside");
  assert.equal(await readFile(join(linkDir, "SYSTEM.md"), "utf8"), "escaped\n");
});

test("reports a dangling link at a project entry as not-a-file, not as a link outside the roots", async () => {
  // The link itself is inside the roots; its target is gone, so there is no file
  // to read or write — the reason the API's own list names for it.
  const dangling = join(root, "workspace", "dangling");
  await mkdir(join(dangling, ".pi"), { recursive: true });
  await symlink(join(root, "gone", "SYSTEM.md"), join(dangling, ".pi", "SYSTEM.md"));
  allowFileRoot(dangling);

  const listed = await get(forCwd(dangling));
  assert.equal(listed.status, 200);
  assert.equal(fileOf(listed.body, "system-local").problem, "not-a-file");

  const written = await put({ id: "system-local", content: "x", cwd: dangling });
  assert.equal(written.status, 409);
  assert.equal((await written.json()).reason, "not-a-file");
  assert.equal((await lstat(join(dangling, ".pi", "SYSTEM.md"))).isSymbolicLink(), true,
    "the link is still there, unread and unwritten");
});

test("refuses a cwd outside the folders Pi Web may read, and a non-file path", async () => {
  const denied = await get(forCwd(other));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.reason, "cwd-denied");

  const relative = await get("?cwd=relative/path");
  assert.equal(relative.status, 400);
  assert.equal(relative.body.reason, "cwd-invalid");

  // A directory where a context file would be is listed with the problem, not read.
  await mkdir(join(agentDir, "SYSTEM.md"), { recursive: true });
  const blocked = await get();
  assert.equal(fileOf(blocked.body, "system-global").problem, "not-a-file");
  const refused = await put({ id: "system-global", content: "x" });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).reason, "not-a-file");
  await rm(join(agentDir, "SYSTEM.md"), { recursive: true });
});

test("refuses text larger than Pi Web writes in one file", async () => {
  const response = await put({ id: "system-global", content: "x".repeat(300 * 1024) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).reason, "too-large");
});
