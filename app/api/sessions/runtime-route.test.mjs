import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const contextRoute = await readFile(new URL("./[id]/context/route.ts", import.meta.url), "utf8");
const stateRoute = await readFile(new URL("./[id]/state/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: getSessionDetail, DELETE: deleteSession } = await jiti.import("./[id]/route.ts");
const { GET: getSessionState } = await jiti.import("./[id]/state/route.ts");
const { cacheSessionPath } = await jiti.import("../../../lib/session-reader.ts");

test("session listing merges live registry snapshots and honors force refresh", () => {
  assert.match(listRoute, /searchParams\.get\("force"\) === "1"/);
  assert.match(listRoute, /listAllSessions\(\{ force \}\)/);
  assert.match(listRoute, /attachSessionProjectInfo\(getRpcSessionInfos\(\)\)/);
  assert.match(listRoute, /mergeSessionLists\(persistedSessions, runtimeSessions\)/);
  assert.match(listRoute, /"Cache-Control": "no-store"/);
});

test("session reads use the live SessionManager before requiring a JSONL path", () => {
  for (const source of [detailRoute, contextRoute]) {
    const liveLookup = source.indexOf("getRpcSession(id)");
    const pathLookup = source.indexOf("resolveSessionPath(id)");
    assert.ok(liveLookup >= 0);
    assert.ok(pathLookup > liveLookup);
    assert.match(source, /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/);
  }
});

test("live agent state is available before the session file is persisted", () => {
  const liveLookup = stateRoute.indexOf("getRpcSession(id)");
  const pathLookup = stateRoute.indexOf("resolveSessionPath(id)");
  assert.ok(liveLookup >= 0);
  assert.ok(pathLookup > liveLookup);
  assert.match(stateRoute, /if \(rpc\?\.isAlive\(\)\)/);
});

test("live detail and state routes work without a persisted JSONL file", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-route-test";
  const timestamp = "2026-08-12T01:02:03.000Z";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: "hello live" },
  };
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp }),
    getEntries: () => [entry],
    getLeafId: () => entry.id,
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () => `/tmp/pi-web-live-route-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
    cwd: "/tmp",
    send: async () => ({ isStreaming: true }),
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const detailResponse = await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`),
    routeContext,
  );
  const stateResponse = await getSessionState(
    new Request(`http://localhost/api/sessions/${id}/state`),
    routeContext,
  );
  const detail = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(detail.info.transient, true);
  assert.deepEqual(detail.context.messages.map((message) => message.content), ["hello live"]);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    running: true,
    state: { isStreaming: true },
  });
});

test("delete of an unknown session still returns 404", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await deleteSession(
    new Request("http://localhost/api/sessions/00000000-0000-0000-0000-000000000000", { method: "DELETE" }),
    { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
  );
  assert.equal(response.status, 404);
});

test("delete shuts down a transient session that has no file yet", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "transient-delete-test";
  const calls = [];
  globalThis.__piSessions = new Map([
    [id, { isAlive: () => true, shutdown: async () => { calls.push("shutdown"); } }],
  ]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["shutdown"]);
});

test("delete refuses when the cached path does not belong to the requested id", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-session-mismatch-"));
  const otherId = "some-other-session";
  const path = join(dir, `${otherId}.jsonl`);
  writeFileSync(path, `${JSON.stringify({
    type: "session", version: 3, id: otherId, timestamp: "2026-08-14T00:00:00.000Z", cwd: dir,
  })}\n`);
  const requestedId = "requested-session";
  cacheSessionPath(requestedId, path);
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${requestedId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: requestedId }) },
  );
  assert.equal(response.status, 404);
  assert.ok(existsSync(path), "mismatched file must not be unlinked");
});

test("rename goes through the live wrapper when one exists", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-session-rename-"));
  const id = "rename-live-test";
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, `${JSON.stringify({
    type: "session", version: 3, id, timestamp: "2026-08-14T00:00:00.000Z", cwd: dir,
  })}\n`);
  cacheSessionPath(id, path);
  const sent = [];
  globalThis.__piSessions = new Map([
    [id, { isAlive: () => true, send: async (command) => { sent.push(command); return null; } }],
  ]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const { PATCH: patchSession } = await jiti.import("./[id]/route.ts");
  const response = await patchSession(
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new name" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sent, [{ type: "set_session_name", name: "new name" }]);
  assert.doesNotMatch(readFileSync(path, "utf8"), /session_info/);
});

test("rename into the reserved subagent namespace is rejected with 409", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "rename-into-reserved-test";
  const sent = [];
  globalThis.__piSessions = new Map([
    [id, {
      isAlive: () => true,
      inner: { sessionManager: { getSessionName: () => "Main task" } },
      send: async (command) => { sent.push(command); return null; },
    }],
  ]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const { PATCH: patchSession } = await jiti.import("./[id]/route.ts");
  const response = await patchSession(
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "subagent-worker-317e1ca0-1" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(sent, []);
});

test("rename out of the reserved subagent namespace is rejected with 409", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-session-rename-reserved-"));
  const id = "rename-out-of-reserved-test";
  const path = join(dir, `${id}.jsonl`);
  const original = [
    JSON.stringify({
      type: "session", version: 3, id, timestamp: "2026-08-14T00:00:00.000Z", cwd: dir,
    }),
    JSON.stringify({
      type: "session_info", id: "si1", parentId: null, timestamp: "2026-08-14T00:00:00.000Z",
      name: "subagent-worker-317e1ca0-1",
    }),
    "",
  ].join("\n");
  writeFileSync(path, original);
  cacheSessionPath(id, path);
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const { PATCH: patchSession } = await jiti.import("./[id]/route.ts");
  const response = await patchSession(
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ordinary name" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 409);
  assert.equal(readFileSync(path, "utf8"), original, "file must be untouched");
});

test("delete shuts down live child sessions before rewriting their files", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-session-delete-"));
  const parentId = "parent-delete-test";
  const childId = "child-delete-test";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childPath = join(dir, `${childId}.jsonl`);
  writeFileSync(parentPath, `${JSON.stringify({
    type: "session", version: 3, id: parentId, timestamp: "2026-08-14T00:00:00.000Z", cwd: dir,
  })}\n`);
  writeFileSync(childPath, `${JSON.stringify({
    type: "session", version: 3, id: childId, timestamp: "2026-08-14T00:00:01.000Z", cwd: dir,
    parentSession: parentPath,
  })}\n${JSON.stringify({
    type: "message", id: "m1", parentId: null, timestamp: "2026-08-14T00:00:02.000Z",
    message: { role: "user", content: "keep me" },
  })}\n`);
  cacheSessionPath(parentId, parentPath);
  cacheSessionPath(childId, childPath);

  const order = [];
  globalThis.__piSessions = new Map([
    [childId, { isAlive: () => true, shutdown: async () => { order.push("child-shutdown"); } }],
    [parentId, { isAlive: () => true, shutdown: async () => { order.push("parent-shutdown"); } }],
  ]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(order, ["child-shutdown", "parent-shutdown"]);
  const childHeader = JSON.parse(readFileSync(childPath, "utf8").split("\n")[0]);
  assert.equal(childHeader.parentSession, undefined);
  assert.match(readFileSync(childPath, "utf8"), /keep me/);
});

test("session listing caps firstMessage without mutating the source", async () => {
  const { compactSessionForList } = await jiti.import("./route.ts");
  const source = {
    id: "long",
    path: "/tmp/long.jsonl",
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "x".repeat(2_000),
  };

  const compact = compactSessionForList(source);
  assert.equal(compact.firstMessage.length, 512);
  assert.equal(source.firstMessage.length, 2_000);
  assert.equal(compactSessionForList({ ...source, firstMessage: "short" }).firstMessage, "short");
});
