import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-session-ui-state-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, dynamic } = await jiti.import("./route.ts");
const { resetSessionUiStateCacheForTests } = await jiti.import("../../../../lib/session-ui-state.ts");

const statePath = path.join(agentDir, "pi-web-session-state.json");
const JSON_HEADERS = { host: "localhost", "Content-Type": "application/json" };

function post(body, headers = JSON_HEADERS) {
  return POST(new Request("http://localhost/api/sessions/ui-state", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

async function okState(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return (await response.json()).state;
}

async function reset() {
  await rm(statePath, { force: true });
  resetSessionUiStateCacheForTests();
}

test("GET answers an empty state when nothing was saved", async () => {
  await reset();
  assert.equal(dynamic, "force-dynamic");
  const response = await GET();
  assert.deepEqual(await okState(response), { version: 1, revision: 0, sessions: {}, projects: {} });
  await assert.rejects(stat(statePath), { code: "ENOENT" });
});

test("set pins and archives, the two exclude each other, and GET reads it back", async () => {
  await reset();
  const pinned = await okState(await post({ action: "set", ids: ["s1", "s2"], pinned: true }));
  assert.equal(pinned.revision, 1);
  assert.deepEqual(Object.keys(pinned.sessions).sort(), ["s1", "s2"]);
  assert.equal(typeof pinned.sessions.s1.pinnedAt, "number");

  const archived = await okState(await post({ action: "set", ids: ["s1"], archived: true }));
  assert.equal(archived.revision, 2);
  assert.equal(typeof archived.sessions.s1.archivedAt, "number");
  assert.equal(archived.sessions.s1.pinnedAt, undefined);
  assert.deepEqual(archived.sessions.s2, pinned.sessions.s2);

  const repinned = await okState(await post({ action: "set", ids: ["s1"], pinned: true }));
  assert.equal(repinned.sessions.s1.archivedAt, undefined, "pinning restores an archived family");
  assert.equal(typeof repinned.sessions.s1.pinnedAt, "number");

  assert.deepEqual(await okState(await GET()), repinned);
  if (process.platform !== "win32") assert.equal((await stat(statePath)).mode & 0o777, 0o600);
});

test("the revision moves only when something changed", async () => {
  await reset();
  const first = await okState(await post({ action: "set", ids: ["a"], archived: true }));
  const before = await readFile(statePath, "utf8");
  const noop = await okState(await post({ action: "set", ids: ["b"], pinned: false }));
  assert.equal(noop.revision, first.revision);
  assert.equal(await readFile(statePath, "utf8"), before);
  const unarchived = await okState(await post({ action: "set", ids: ["a"], archived: false }));
  assert.equal(unarchived.revision, first.revision + 1);
  assert.deepEqual(unarchived.sessions, {});
});

test("restore undoes an archive with the exact prior values", async () => {
  await reset();
  const start = await okState(await post({ action: "set", ids: ["keep"], pinned: true }));
  const prior = [
    { id: "keep", pinnedAt: start.sessions.keep.pinnedAt, archivedAt: null },
    { id: "fresh", pinnedAt: null, archivedAt: null },
  ];
  await okState(await post({ action: "set", ids: ["keep", "fresh"], archived: true }));
  const restored = await okState(await post({ action: "restore", entries: prior }));
  assert.deepEqual(restored.sessions, start.sessions);
});

test("pin-project pins and unpins a project with its root", async () => {
  await reset();
  const pinned = await okState(await post({ action: "pin-project", projectKey: "/repo", root: "/Repo", pinned: true }));
  assert.equal(pinned.projects["/repo"].root, "/Repo");
  assert.equal(typeof pinned.projects["/repo"].pinnedAt, "number");
  const unpinned = await okState(await post({ action: "pin-project", projectKey: "/repo", root: "/Repo", pinned: false }));
  assert.deepEqual(unpinned.projects, {});
  assert.equal(unpinned.revision, pinned.revision + 1);
});

test("add-projects and move-project keep the project order, and GET reads it back", async () => {
  await reset();
  const added = await okState(await post({ action: "add-projects", keys: ["/b", "/a", "/b"] }));
  assert.deepEqual(added.projectOrder, ["/b", "/a"]);
  const moved = await okState(await post({ action: "move-project", projectKey: "/c", anchorKey: "/a", position: "before", add: ["/c"] }));
  assert.deepEqual(moved.projectOrder, ["/b", "/c", "/a"]);
  assert.equal(moved.revision, added.revision + 1);
  assert.deepEqual((await okState(await GET())).projectOrder, ["/b", "/c", "/a"]);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")).projectOrder, ["/b", "/c", "/a"]);
});

test("refuses untrusted, non-JSON and invalid requests without writing", async () => {
  await reset();
  const cases = [
    [post({ action: "set", ids: ["a"], pinned: true }, { ...JSON_HEADERS, Origin: "https://evil.example" }), 403, "request-denied"],
    [post({ action: "set", ids: ["a"], pinned: true }, { ...JSON_HEADERS, "Sec-Fetch-Site": "cross-site" }), 403, "request-denied"],
    [post({ action: "set", ids: ["a"], pinned: true }, { ...JSON_HEADERS, host: "evil.example" }), 403, "request-denied"],
    [post({ action: "set", ids: ["a"], pinned: true }, { host: "localhost", "Content-Type": "text/plain" }), 415, "content-type"],
    [post({ action: "set", ids: ["a"], pinned: true }, { host: "localhost" }), 415, "content-type"],
    [post("{ nope"), 400, "invalid-request"],
    [post("[]"), 400, "invalid-request"],
    [post("null"), 400, "invalid-request"],
    [post({ action: "set", ids: ["a"], pinned: true, archived: false }), 400, "invalid-request"],
    [post({ action: "set", ids: ["../escape"], pinned: true }), 400, "invalid-request"],
    [post({ action: "set", ids: [], archived: true }), 400, "invalid-request"],
    [post({ action: "pin-project", projectKey: "", root: "/r", pinned: true }), 400, "invalid-request"],
    [post({ action: "add-projects", keys: [] }), 400, "invalid-request"],
    [post({ action: "move-project", projectKey: "/a", anchorKey: "/a", position: "before" }), 400, "invalid-request"],
    [post({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "middle" }), 400, "invalid-request"],
    [post({ action: "drop-everything" }), 400, "invalid-request"],
  ];
  for (const [pending, status, reason] of cases) {
    const response = await pending;
    assert.equal(response.status, status, reason);
    const body = await response.json();
    assert.equal(body.reason, reason);
    assert.equal(typeof body.error, "string");
  }
  await assert.rejects(stat(statePath), { code: "ENOENT" });
});

test("a corrupt file is kept as a backup and the state starts over", async () => {
  await reset();
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(statePath, "{\"version\":1,\"sessions\":");
    assert.deepEqual((await okState(await GET())).sessions, {});
    const next = await okState(await post({ action: "set", ids: ["a"], pinned: true }));
    assert.deepEqual(Object.keys(next.sessions), ["a"]);
    assert.equal(next.revision, 2);
    const backups = (await readdir(agentDir)).filter((name) => name.startsWith("pi-web-session-state.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(agentDir, backups[0]), "utf8"), "{\"version\":1,\"sessions\":");
    for (const backup of backups) await rm(path.join(agentDir, backup));
  } finally {
    console.warn = previousWarn;
  }
});

test("a lock held elsewhere answers 409 locked", async () => {
  await reset();
  await mkdir(`${statePath}.lock`, { recursive: true });
  try {
    const response = await post({ action: "set", ids: ["a"], pinned: true });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, "locked");
  } finally {
    await rm(`${statePath}.lock`, { recursive: true, force: true });
  }
});
