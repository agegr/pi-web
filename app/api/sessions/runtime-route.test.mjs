import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const { DELETE: deleteSession, GET: getSessionDetail, PATCH: renameSession } = await jiti.import("./[id]/route.ts");
const { GET: getSessionList } = await jiti.import("./route.ts");
const { GET: getRunningSessions } = await jiti.import("../agent/running/route.ts");
const { GET: getSessionState } = await jiti.import("./[id]/state/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
} = await jiti.import("../../../lib/session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

test("list versions expose idle session creation, rename and deletion to other windows", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-list-sync-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  let sessionId;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (sessionId) invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  const list = async () => {
    const response = await getSessionList(new Request("http://localhost/api/sessions"));
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await list();
  assert.deepEqual(initial.sessions, []);

  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Cross-window search fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Already finished" }], timestamp: Date.now() });
  sessionId = manager.getSessionId();
  invalidateSessionListCache();
  const created = await list();
  assert.ok(created.sessionListVersion > initial.sessionListVersion);
  assert.equal(created.sessions[0].id, sessionId);
  assert.deepEqual(created.runningSessionIds, []);

  const context = { params: Promise.resolve({ id: sessionId }) };
  const url = `http://localhost/api/sessions/${sessionId}`;
  const renamed = await renameSession(new Request(url, { method: "PATCH", body: JSON.stringify({ name: "Renamed elsewhere" }) }), context);
  assert.equal(renamed.status, 200);
  const poll = await (await getRunningSessions()).json();
  assert.deepEqual(poll.runningSessionIds, []);
  assert.ok(poll.sessionListVersion > created.sessionListVersion);
  const updated = await list();
  assert.equal(updated.sessionListVersion, poll.sessionListVersion);
  assert.equal(updated.sessions[0].name, "Renamed elsewhere");
  assert.equal((await list()).sessionListVersion, poll.sessionListVersion, "reads must not create a refresh loop");

  assert.equal((await deleteSession(new Request(url, { method: "DELETE" }), context)).status, 200);
  const deleted = await list();
  assert.ok(deleted.sessionListVersion > updated.sessionListVersion);
  assert.deepEqual(deleted.sessions, []);
  assert.equal((await (await getRunningSessions()).json()).sessionListVersion, deleted.sessionListVersion);
});

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

test("deleting an intermediate subagent reparents both relation representations", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-reparent-"));
  const grandparentPath = join(dir, "grandparent.jsonl");
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const parentId = "delete-reparent-parent";
  const header = (id, parentSession) => JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    ...(parentSession ? { parentSession } : {}),
  });
  await writeFile(grandparentPath, `${header("delete-reparent-grandparent")}\n`);
  await writeFile(parentPath, `${header(parentId, grandparentPath)}\n`);
  await writeFile(childPath, [
    header("delete-reparent-child", parentPath),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: parentId,
        parentSessionPath: parentPath,
        profile: "Explore",
        description: "Inspect parser",
      },
    }),
    "",
  ].join("\n"));
  cacheSessionPath(parentId, parentPath);
  t.after(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: parentId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(parentPath), { code: "ENOENT" });
  const [childHeaderLine, childMetadataLine] = (await readFile(childPath, "utf8")).trim().split("\n");
  assert.equal(JSON.parse(childHeaderLine).parentSession, grandparentPath);
  assert.deepEqual(JSON.parse(childMetadataLine).data, {
    version: 1,
    parentSessionId: "delete-reparent-grandparent",
    parentSessionPath: grandparentPath,
    profile: "Explore",
    description: "Inspect parser",
  });
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
  assert.equal(detail.info.projectRoot, "/tmp");
  assert.equal(typeof detail.info.projectKey, "string");
  assert.deepEqual(detail.context.messages.map((message) => message.content), ["hello live"]);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    running: true,
    state: { isStreaming: true },
  });
});
