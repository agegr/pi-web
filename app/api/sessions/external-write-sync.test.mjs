// Integration test for external-write auto-sync (issue: pi TUI writes to a
// session file while pi-web has it open). Follows the fixture pattern of
// runtime-route.test.mjs: PI_CODING_AGENT_DIR points at a temp agent dir, and
// the production routes observe a .jsonl written by "another process" via
// plain fs calls. Asserts the watcher bumps the session list version, the new
// session appears in the list without a force refresh, /api/agent/running
// reports the write for the open-view refresh, and reads alone never bump the
// version (no refresh loop).
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-external-sync-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const projectDir = join(agentDir, "sessions", "encoded-cwd");
mkdirSync(projectDir, { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: getSessionList } = await jiti.import("./route.ts");
const { GET: getRunningSessions } = await jiti.import("../agent/running/route.ts");
const { invalidateSessionListCache } = await jiti.import("../../../lib/session-reader.ts");
const { disposeSessionWatcher } = await jiti.import("../../../lib/session-watcher.ts");

const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const sessionFile = join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);

const sessionHeader = JSON.stringify({
  type: "session",
  version: 3,
  id: SESSION_ID,
  cwd: "/tmp",
  timestamp: "2026-01-01T00:00:00.000Z",
});
const firstEntry = JSON.stringify({
  id: "aaaa0001",
  parentId: null,
  type: "message",
  timestamp: "2026-01-01T00:00:01.000Z",
  message: { role: "user", content: [{ type: "text", text: "Written by the TUI" }] },
});
const laterEntry = JSON.stringify({
  id: "bbbb0002",
  parentId: "aaaa0001",
  type: "message",
  timestamp: "2026-01-01T00:00:02.000Z",
  message: { role: "assistant", content: [{ type: "text", text: "TUI reply" }] },
});

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return await predicate();
}

after(async () => {
  disposeSessionWatcher();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  invalidateSessionListCache();
  rmSync(agentDir, { recursive: true, force: true });
});

test("an externally written session appears without a force refresh and reads stay inert", async () => {
  disposeSessionWatcher();
  invalidateSessionListCache();

  const list = async () => {
    const response = await getSessionList(new Request("http://localhost/api/sessions"));
    assert.equal(response.status, 200);
    return response.json();
  };
  const running = async () => {
    const response = await getRunningSessions(new Request("http://localhost/api/agent/running"));
    assert.equal(response.status, 200);
    return response.json();
  };

  // First list call starts the watcher lazily (production path) and baselines
  // the version.
  const initial = await list();
  assert.deepEqual(initial.sessions, []);
  const baselineVersion = initial.sessionListVersion;

  // Simulate the pi TUI creating and appending to the session file.
  appendFileSync(sessionFile, `${sessionHeader}\n${firstEntry}\n`);

  const detected = await waitFor(async () => {
    const current = await list();
    return current.sessionListVersion > baselineVersion;
  });
  assert.ok(detected, "the watcher must invalidate the session list after an external write");

  const created = await list();
  assert.ok(
    created.sessionListVersion > baselineVersion,
    "the session list version must rise after the external write",
  );
  const listed = created.sessions.find((session) => session.id === SESSION_ID);
  assert.ok(listed, "the externally created session must appear in the list");
  assert.equal(listed.firstMessage, "Written by the TUI");

  // The running poll reports the write so the open chat view can reload.
  const runningSnapshot = await running();
  const writeReport = (runningSnapshot.recentSessionWrites ?? []).find(
    (write) => write.sessionId === SESSION_ID,
  );
  assert.ok(writeReport, "/api/agent/running must report the external write");
  assert.ok(writeReport.generation >= 1);
  assert.equal(writeReport.path, sessionFile);

  // Another external append raises the generation for the open-view refresh.
  const generationBefore = writeReport.generation;
  appendFileSync(sessionFile, `${laterEntry}\n`);
  const generationRose = await waitFor(async () => {
    const snapshot = await running();
    const entry = (snapshot.recentSessionWrites ?? []).find(
      (write) => write.sessionId === SESSION_ID,
    );
    return entry !== undefined && entry.generation > generationBefore;
  });
  assert.ok(generationRose, "a further external append must raise the session's write generation");

  // Reads-only invariant: repeated list and running reads must not bump the
  // version (no self-sustaining refresh loop).
  const settledVersion = (await list()).sessionListVersion;
  for (let i = 0; i < 3; i += 1) {
    await list();
    await running();
  }
  assert.equal(
    (await list()).sessionListVersion,
    settledVersion,
    "reads alone must never bump the session list version",
  );
});
