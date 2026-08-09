import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  buildRunningSessionSnapshot,
  formatRunningToolDetail,
  mergeRunningSessionSnapshots,
  resolveRunningStatus,
  runningSnapshotToSessionInfo,
} = await jiti.import("./running-sessions.ts");

const baseStatusInput = {
  isCompacting: false,
  isBashRunning: false,
  isStreaming: false,
  isPromptRunning: false,
};

test("running status uses the documented priority", () => {
  assert.deepEqual(
    resolveRunningStatus({
      ...baseStatusInput,
      isCompacting: true,
      isBashRunning: true,
      isStreaming: true,
      activeTools: [{ name: "read", detail: "read app/page.tsx" }],
    }),
    { kind: "compacting" },
  );
  assert.deepEqual(
    resolveRunningStatus({
      ...baseStatusInput,
      isBashRunning: true,
      isStreaming: true,
      bashCommand: "npm run typecheck",
    }),
    { kind: "executing", detail: "npm run typecheck" },
  );
  assert.deepEqual(
    resolveRunningStatus({ ...baseStatusInput, isStreaming: true }),
    { kind: "generating" },
  );
  assert.deepEqual(resolveRunningStatus(baseStatusInput), { kind: "processing" });
});

test("running status includes queued-independent tool details", () => {
  assert.deepEqual(
    resolveRunningStatus({
      ...baseStatusInput,
      isStreaming: true,
      activeTools: [{ name: "read", detail: "read components/AppShell.tsx" }],
    }),
    { kind: "executing", detail: "read components/AppShell.tsx" },
  );
  assert.equal(formatRunningToolDetail("bash", { command: "npm test" }), "bash npm test");
  assert.equal(formatRunningToolDetail("read", { path: "components/AppShell.tsx" }), "read components/AppShell.tsx");
});

test("running navigation snapshot falls back to live metadata", () => {
  const snapshot = buildRunningSessionSnapshot(
    {
      id: "1234567890abcdef",
      path: "E:/sessions/live.jsonl",
      cwd: "E:/agent-lab",
      firstMessage: "Investigate OAuth timeout",
      messageCount: 3,
      status: { kind: "generating" },
      queued: 2,
    },
    undefined,
    { projectRoot: "E:/agent-lab", isWorktree: false },
  );

  assert.deepEqual(snapshot, {
    id: "1234567890abcdef",
    path: "E:/sessions/live.jsonl",
    title: "Investigate OAuth timeout",
    cwd: "E:/agent-lab",
    projectRoot: "E:/agent-lab",
    messageCount: 3,
    status: { kind: "generating" },
    queued: 2,
  });
});

test("partial running snapshots preserve the last known status and expose unknown new status", () => {
  const previous = {
    id: "known-session",
    path: "E:/sessions/known.jsonl",
    title: "Known session",
    cwd: "E:/work",
    projectRoot: "E:/work",
    messageCount: 2,
    status: { kind: "executing", detail: "bash npm test" },
    queued: 1,
  };

  assert.deepEqual(
    mergeRunningSessionSnapshots(
      [previous],
      [{ id: "known-session", title: "Known session" }],
      ["known-session", "new-session"],
    ),
    [
      previous,
      {
        id: "new-session",
        path: "",
        title: "new-session",
        cwd: "",
        projectRoot: "",
        messageCount: 0,
        status: { kind: "unknown" },
        queued: 0,
      },
    ],
  );
});

test("a completed running snapshot can enter history without a second identity", () => {
  const info = runningSnapshotToSessionInfo({
    id: "completed-session",
    path: "E:/sessions/completed.jsonl",
    title: "Finish navigation",
    cwd: "E:/pi-web",
    projectRoot: "E:/pi-web",
    messageCount: 4,
    status: { kind: "generating" },
    queued: 0,
    cwdAvailable: false,
  }, "2026-02-03T04:05:06.000Z");

  assert.deepEqual(info, {
    path: "E:/sessions/completed.jsonl",
    id: "completed-session",
    cwd: "E:/pi-web",
    created: "2026-02-03T04:05:06.000Z",
    modified: "2026-02-03T04:05:06.000Z",
    messageCount: 4,
    firstMessage: "Finish navigation",
    projectRoot: "E:/pi-web",
    cwdAvailable: false,
  });
});

test("session-list metadata wins over the live first-message fallback", () => {
  const snapshot = buildRunningSessionSnapshot(
    {
      id: "session-id",
      path: "E:/sessions/live.jsonl",
      cwd: "E:/worktree",
      name: "live name",
      firstMessage: "live first message",
      messageCount: 1,
      status: { kind: "executing", detail: "bash npm test" },
      queued: 0,
    },
    {
      path: "E:/sessions/session.jsonl",
      id: "session-id",
      cwd: "E:/worktree",
      name: "saved name",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:01:00.000Z",
      messageCount: 7,
      firstMessage: "saved first message",
      projectRoot: "E:/repo",
      worktreeBranch: "feature/live",
    },
    { projectRoot: "E:/repo", branch: "feature/live", isWorktree: true },
  );

  assert.equal(snapshot.title, "saved name");
  assert.equal(snapshot.projectRoot, "E:/repo");
  assert.equal(snapshot.worktreeBranch, "feature/live");
  assert.equal(snapshot.messageCount, 7);
});
