import assert from "node:assert/strict";
import test from "node:test";

// Tests for findEntryForTask — the pure helper that maps a taskId to the
// latest session entry that mentions it. Drives the click-to-jump behavior
// for the InspectorPanel task list.
//
// The function lives in lib/task-entry-resolver.ts and walks SessionEntry[]
// (from getSessionEntries). We use minimal mock objects here so the test
// stays focused on the resolver's own logic — no need for a real jsonl.

async function loadSubject() {
  return import("./task-entry-resolver.ts");
}

/**
 * Build a minimal SessionEntry-shaped object. Only the fields the resolver
 * reads need to be present.
 */
function makeTodoEntry({ id, parentId = null, tasks, nextId, deleted = false }) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: "2026-01-01T00:00:00Z",
    message: {
      role: "toolResult",
      toolName: "todo",
      details: deleted
        ? { tasks: tasks.map((t) => ({ ...t, status: "deleted" })), nextId }
        : { tasks, nextId },
    },
  };
}

function makeNonTodoEntry(id, role = "assistant") {
  return {
    id,
    parentId: null,
    type: "message",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role, content: [] },
  };
}

function makeOtherEntry(id) {
  return {
    id,
    parentId: null,
    type: "model_change",
    timestamp: "2026-01-01T00:00:00Z",
    model: { provider: "x", modelId: "y" },
  };
}

test("returns null when entries is empty", async () => {
  const { findEntryForTask } = await loadSubject();
  assert.equal(findEntryForTask([], 1), null);
});

test("returns null when no entries contain the requested taskId", async () => {
  const { findEntryForTask } = await loadSubject();
  const entries = [
    makeTodoEntry({
      id: "a",
      tasks: [{ id: 1, subject: "first", status: "completed" }],
      nextId: 2,
    }),
    makeTodoEntry({
      id: "b",
      tasks: [{ id: 2, subject: "second", status: "in_progress" }],
      nextId: 3,
    }),
  ];
  assert.equal(findEntryForTask(entries, 99), null);
});

test("returns null when there are no todo entries at all", async () => {
  const { findEntryForTask } = await loadSubject();
  const entries = [
    makeNonTodoEntry("x", "user"),
    makeNonTodoEntry("y", "assistant"),
    makeOtherEntry("z"),
  ];
  assert.equal(findEntryForTask(entries, 1), null);
});

test("returns the nearest user/assistant before the matching toolResult (jump target)", async () => {
  const { findEntryForTask } = await loadSubject();
  // toolResult 不单独渲染（作为 assistant 附属），跳转目标应是它前面的 user/assistant，
  // 这样 ChatWindow 的 register（只挂 user/assistant DOM）才能命中。
  const before = makeNonTodoEntry("before", "assistant");
  const target = makeTodoEntry({
    id: "target",
    tasks: [{ id: 5, subject: "x", status: "completed" }],
    nextId: 6,
  });
  const entries = [
    before,
    target,
    makeTodoEntry({ id: "after", tasks: [{ id: 6, subject: "y", status: "pending" }], nextId: 7 }),
  ];
  assert.equal(findEntryForTask(entries, 5), before);
});

test("returns the LATEST matching entry when taskId appears in multiple snapshots", async () => {
  const { findEntryForTask } = await loadSubject();
  // Same taskId 1 — created in entry "create", updated in "update" (status changed).
  const create = makeTodoEntry({
    id: "create",
    tasks: [{ id: 1, subject: "x", status: "pending" }],
    nextId: 2,
  });
  const update = makeTodoEntry({
    id: "update",
    tasks: [{ id: 1, subject: "x", status: "completed" }],
    nextId: 2,
  });
  const later = makeTodoEntry({
    id: "later",
    tasks: [{ id: 2, subject: "y", status: "pending" }],
    nextId: 3,
  });
  const entries = [create, update, later];
  // Clicking the task should jump to the LATEST snapshot that mentions it.
  assert.equal(findEntryForTask(entries, 1), update);
});

test("ignores entries whose toolName is not 'todo'", async () => {
  const { findEntryForTask } = await loadSubject();
  const entries = [
    // toolResult but for read tool, not todo
    {
      id: "r1",
      parentId: null,
      type: "message",
      timestamp: "t",
      message: {
        role: "toolResult",
        toolName: "read",
        details: { tasks: [{ id: 1, subject: "x", status: "pending" }], nextId: 2 },
      },
    },
    makeTodoEntry({ id: "t1", tasks: [{ id: 1, subject: "x", status: "completed" }], nextId: 2 }),
  ];
  assert.equal(findEntryForTask(entries, 1)?.id, "t1");
});

test("matches deleted-task tombstones too (latest reference wins)", async () => {
  const { findEntryForTask } = await loadSubject();
  // Task 1 was created, then completed, then deleted (tombstone).
  const entries = [
    makeTodoEntry({ id: "c", tasks: [{ id: 1, subject: "x", status: "pending" }], nextId: 2 }),
    makeTodoEntry({ id: "d", tasks: [{ id: 1, subject: "x", status: "completed" }], nextId: 2 }),
    makeTodoEntry({ id: "e", tasks: [{ id: 1, subject: "x" }], nextId: 2, deleted: true }),
  ];
  // UI hides deleted tasks, but if something asks, return the latest reference.
  assert.equal(findEntryForTask(entries, 1)?.id, "e");
});

test("ignores entries where details does not match the todo shape", async () => {
  const { findEntryForTask } = await loadSubject();
  const entries = [
    {
      id: "bad",
      parentId: null,
      type: "message",
      timestamp: "t",
      message: { role: "toolResult", toolName: "todo", details: { wrong: "shape" } },
    },
    makeTodoEntry({ id: "good", tasks: [{ id: 1, subject: "x", status: "completed" }], nextId: 2 }),
  ];
  assert.equal(findEntryForTask(entries, 1)?.id, "good");
});

test("smoke: probe with absurd taskId returns null on real session entries", async () => {
  // Pick a real session file and walk its entries. We don't care which
  // tasks exist; we just want to confirm the resolver never crashes on
  // the real entry shape and returns null for an unknown taskId.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const home = process.env.HOME || "/root";
  let latest = null;
  let latestMtime = 0;
  const candidates = await fs.readdir(path.join(home, ".pi/agent/sessions")).catch(() => []);
  for (const dir of candidates) {
    const dirPath = path.join(home, ".pi/agent/sessions", dir);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await fs.readdir(dirPath).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(dirPath, f);
      const fStat = await fs.stat(fp).catch(() => null);
      if (fStat && fStat.mtimeMs > latestMtime) {
        latestMtime = fStat.mtimeMs;
        latest = fp;
      }
    }
  }
  if (!latest) return; // no sessions yet — nothing to verify, pass

  const raw = await fs.readFile(latest, "utf8");
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  const { findEntryForTask } = await loadSubject();
  assert.equal(findEntryForTask(entries, 999999), null);
});
