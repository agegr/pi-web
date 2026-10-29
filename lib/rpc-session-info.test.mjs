import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { getRpcSessionInfos, subagentDisplayStatus, withSubagentDisplayStatus } = await jiti.import("./rpc-manager.ts");

function makeRuntimeSession({ id, filePath, running, entries }) {
  const timestamp = "2026-08-12T01:02:03.000Z";
  const manager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp/runtime-cwd", timestamp }),
    getEntries: () => entries,
    getSessionFile: () => filePath,
    getSessionName: () => undefined,
  };
  return {
    isAlive: () => true,
    isRunning: () => running,
    inner: { sessionManager: manager },
    get sessionId() { return id; },
    get sessionFile() { return filePath; },
    get cwd() { return "/tmp/runtime-cwd"; },
  };
}

test("lists an accepted new prompt before its session file exists", (t) => {
  const previousRegistry = globalThis.__piSessions;
  const timestamp = "2026-08-12T01:02:04.000Z";
  const visible = makeRuntimeSession({
    id: "visible-runtime",
    filePath: join(tmpdir(), "pi-web-missing-runtime-session.jsonl"),
    running: true,
    entries: [{
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: {
        role: "user",
        content: [{ type: "text", text: "first" }, { type: "text", text: "prompt" }],
      },
    }],
  });
  const emptyEnsureSession = makeRuntimeSession({
    id: "empty-runtime",
    filePath: join(tmpdir(), "pi-web-missing-empty-session.jsonl"),
    running: false,
    entries: [],
  });
  globalThis.__piSessions = new Map([
    ["visible-runtime", visible],
    ["empty-runtime", emptyEnsureSession],
  ]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "visible-runtime");
  assert.equal(infos[0].firstMessage, "first prompt");
  assert.equal(infos[0].messageCount, 1);
  assert.equal(infos[0].transient, true);
});

test("a subagent row's status: settled once no process holds the run, live otherwise", (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSubagentRuns = previousRuns;
  });
  const row = (id, status) => ({
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: "2026-08-12T01:02:03.000Z",
    modified: "2026-08-12T01:02:03.000Z",
    messageCount: 1,
    firstMessage: "task",
    relation: { kind: "subagent", parentSessionId: "parent", profile: "Explore", description: "Inspect", status },
  });
  // A queued run whose idle wrapper was released is still this process's run.
  globalThis.__piSubagentRuns = new Map([["queued-child", { run: { sessionId: "queued-child", status: "queued" } }]]);
  globalThis.__piSessions = new Map([["running-child", makeRuntimeSession({
    id: "running-child",
    filePath: "/tmp/running-child.jsonl",
    running: true,
    entries: [],
  })]]);

  const fork = { ...row("fork", "running"), relation: { kind: "fork" } };
  const completed = row("completed-child", "completed");
  const [orphan, queued, running, done, forkRow] = withSubagentDisplayStatus([
    row("orphaned-child", "running"),
    row("queued-child", "queued"),
    row("running-child", "completed"),
    completed,
    fork,
  ]);

  assert.equal(orphan.relation.status, "interrupted");
  assert.equal(queued.relation.status, "queued");
  assert.equal(running.relation.status, "running");
  assert.equal(done, completed);
  assert.equal(forkRow, fork);
  assert.equal(subagentDisplayStatus("orphaned-queued", "queued"), "interrupted");
});

test("keeps an idle runtime visible once its JSONL file exists", (t) => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-runtime-session-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, "persisted\n");
  globalThis.__piSessions = new Map([["persisted-runtime", makeRuntimeSession({
    id: "persisted-runtime",
    filePath,
    running: false,
    entries: [],
  })]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    rmSync(dir, { recursive: true, force: true });
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].transient, false);
});
