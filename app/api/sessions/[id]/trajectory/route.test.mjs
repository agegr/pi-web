import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const { GET } = await jiti.import("./route.ts");
const { cacheSessionPath } = await jiti.import("../../../../../lib/session-reader.ts");
const { ensureTrajectoryStore, appendTrajectoryRecord } = await jiti.import("../../../../../lib/trajectory-store.ts");

function request(url) {
  return new Request(`http://localhost/api/sessions/s1/trajectory${url}`);
}
function params(id) {
  return { params: Promise.resolve({ id }) };
}

let envRestore;
let rootDir;
let sessionId;
let leafEntryId;
let noSidecarSessionId;

function writeSession(sessionDir, messageContent) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const filePath = join(sessionDir, `${Date.now()}_${id}.jsonl`);
  const entryId = `entry-${id}`;
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: "/tmp/work" }),
    JSON.stringify({ type: "message", id: entryId, parentId: null, timestamp, message: { role: "user", content: messageContent } }),
  ];
  writeFileSync(filePath, lines.join("\n") + "\n");
  cacheSessionPath(id, filePath);
  return { id, entryId };
}

before(async () => {
  envRestore = process.env.PI_CODING_AGENT_DIR;
  rootDir = mkdtempSync(join(tmpdir(), "traj-route-"));
  process.env.PI_CODING_AGENT_DIR = rootDir;
  const sessionDir = join(rootDir, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  const session = writeSession(sessionDir, "hello");
  sessionId = session.id;
  leafEntryId = session.entryId;
  noSidecarSessionId = writeSession(sessionDir, "old").id;

  await ensureTrajectoryStore(rootDir, sessionId, 1000);
  await appendTrajectoryRecord(rootDir, sessionId, {
    schemaVersion: 1,
    type: "record",
    sequence: 1,
    id: "req1",
    kind: "request_start",
    timestamp: 1000,
    leafId: leafEntryId,
    requestId: "req1",
    data: { model: "gpt-5", summary: "request gpt-5" },
  });
  await appendTrajectoryRecord(rootDir, sessionId, {
    schemaVersion: 1,
    type: "record",
    sequence: 2,
    id: "req1end",
    kind: "request_end",
    timestamp: 5000,
    endTimestamp: 5000,
    status: "complete",
    leafId: leafEntryId,
    requestId: "req1",
    data: { usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 }, summary: "request complete" },
  });
});

after(() => {
  if (envRestore === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = envRestore;
  if (rootDir) rmSync(rootDir, { recursive: true, force: true });
});

test("summary response omits raw payload data", async () => {
  const response = await GET(request(`?leafId=${leafEntryId}&detailLevel=summary`), params(sessionId));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.detailLevel, "summary");
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.session.supported, true);
  assert.equal(body.session.leafId, leafEntryId);
  assert.equal(body.stats.requests, 1);
  assert.equal(body.records.length, 2);
  assert.equal("data" in body.records[0], false);
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].model, "gpt-5");
  assert.equal(body.requests[0].durationMs, 4000);
  assert.deepEqual(body.requests[0].usage, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 });
});

test("full response includes bounded data", async () => {
  const response = await GET(request(`?leafId=${leafEntryId}&detailLevel=full`), params(sessionId));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.records[0].data);
  assert.equal(body.records[0].data.model, "gpt-5");
});

test("old sessions without a sidecar return trajectory_unsupported", async () => {
  const response = await GET(request("?detailLevel=summary"), params(noSidecarSessionId));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "trajectory_unsupported");
  assert.equal(body.session.supported, false);
});

test("invalid detailLevel returns 400", async () => {
  const response = await GET(request("?detailLevel=everything"), params(sessionId));
  assert.equal(response.status, 400);
});

test("unknown session returns 404", async () => {
  const response = await GET(request("?detailLevel=summary"), params("unknown-session-id"));
  assert.equal(response.status, 404);
});

test("unknown query parameters are ignored", async () => {
  const response = await GET(request(`?leafId=${leafEntryId}&cursor=unused`), params(sessionId));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal("hasOlderRecords" in body, false);
  assert.equal("nextCursor" in body, false);
});

test("route never starts a new rpc session", () => {
  assert.match(routeSource, /getRpcSession/);
  assert.doesNotMatch(routeSource, /startRpcSession/);
});
