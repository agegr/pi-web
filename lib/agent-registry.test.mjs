import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Point the agent directory at a scratch tree before loading the module, so the
// round-trip below never touches a real registry.
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-registry-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url);
const {
  AGENT_RECORD_VERSION,
  agentSocketPath,
  agentStateDir,
  isAgentRecordStale,
  listAgentRecords,
  parseAgentRecord,
  readAgentRecord,
  removeAgentRecord,
  writeAgentRecord,
} = await jiti.import("./agent-registry.ts");

const record = {
  version: AGENT_RECORD_VERSION,
  protocol: 1,
  sessionId: "session-1",
  pid: process.pid,
  socketPath: "/tmp/pi-web-agents/session-1.sock",
  sessionFile: "/tmp/sessions/session-1.jsonl",
  cwd: "/tmp/project",
  startedAt: 1_700_000_000_000,
};

test("the registry lives under the agent directory", () => {
  assert.equal(agentStateDir(), join(agentDir, "pi-web", "agents"));
  assert.ok(agentSocketPath("session-1").endsWith("session-1.sock"));
});

test("accepts a well-formed record and rejects damaged ones", () => {
  assert.deepEqual(parseAgentRecord(record), record);
  assert.equal(parseAgentRecord(null), null);
  assert.equal(parseAgentRecord({}), null);
  assert.equal(parseAgentRecord({ ...record, sessionId: "   " }), null);
  assert.equal(parseAgentRecord({ ...record, socketPath: undefined }), null);
  assert.equal(parseAgentRecord({ ...record, pid: 0 }), null);
  assert.equal(parseAgentRecord({ ...record, pid: 1.5 }), null);
  // A record from a newer build is readable, but not necessarily adoptable.
  assert.equal(parseAgentRecord({ ...record, protocol: 99 })?.protocol, 99);
});

test("a record is stale when its process is gone or its protocol differs", () => {
  const alive = () => true;
  const dead = () => false;
  assert.equal(isAgentRecordStale(record, { alive }), false);
  assert.equal(isAgentRecordStale(record, { alive: dead }), true);
  assert.equal(isAgentRecordStale({ ...record, protocol: 0 }, { alive }), true);
  assert.equal(isAgentRecordStale({ ...record, protocol: 2 }, { alive, protocol: 2 }), false);
});

test("write, read, list, and remove round-trip through the state directory", () => {
  writeAgentRecord(record);
  assert.deepEqual(readAgentRecord("session-1"), record);
  assert.deepEqual(listAgentRecords().map((entry) => entry.sessionId), ["session-1"]);

  removeAgentRecord("session-1");
  assert.equal(readAgentRecord("session-1"), null);
  assert.deepEqual(listAgentRecords(), []);
  // Removing twice is not an error: a host and its adopter both clean up.
  removeAgentRecord("session-1");
});

test.after(() => {
  rmSync(agentDir, { recursive: true, force: true });
});
