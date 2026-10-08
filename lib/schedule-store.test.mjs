import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const {
  createSchedule, deleteSchedule, getSchedule, isDue, listSchedules,
  nextRunFor, pruneFinishedTasks, recordRun, updateSchedule,
} = await createJiti(import.meta.url).import("./schedule-store.ts");

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "sched-"));
  const path = join(dir, "schedules.json");
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("creates, reads, updates and deletes a task", () => {
  withStore((path) => {
    const task = createSchedule({ prompt: "分析游戏网站浏览量", cwd: "/tmp", cron: "30 9 * * *" }, path);
    assert.equal(task.enabled, true);
    assert.equal(task.runCount, 0);
    assert.equal(listSchedules(path).length, 1);
    assert.equal(getSchedule(task.id, path)?.prompt, "分析游戏网站浏览量");

    const updated = updateSchedule(task.id, { enabled: false }, path);
    assert.equal(updated.enabled, false);

    assert.equal(deleteSchedule(task.id, path), true);
    assert.equal(listSchedules(path).length, 0);
  });
});

test("rejects an invalid cron and an empty prompt", () => {
  withStore((path) => {
    assert.throws(() => createSchedule({ prompt: "x", cwd: "/tmp", cron: "not a cron" }, path), /Invalid cron/);
    assert.throws(() => createSchedule({ prompt: "   ", cwd: "/tmp", cron: "0 9 * * *" }, path), /prompt is required/);
    assert.throws(() => createSchedule({ prompt: "x", cwd: "", cron: "0 9 * * *" }, path), /cwd is required/);
  });
});

test("one-shot tasks accept an absolute time without a cron", () => {
  withStore((path) => {
    const at = new Date(Date.now() + 600000).toISOString();
    const task = createSchedule({ prompt: "一次任务", cwd: "/tmp", runOnceAt: at }, path);
    assert.equal(task.runOnceAt, at);
    assert.ok(nextRunFor(task));
  });
});

test("isDue fires inside the matching minute only once", () => {
  withStore((path) => {
    const task = createSchedule({ prompt: "x", cwd: "/tmp", cron: "30 9 * * *" }, path);
    const at = new Date(2026, 9, 8, 9, 30, 5);
    assert.equal(isDue(task, at), true);

    const after = recordRun(task.id, { sessionId: "sess-1", at }, path);
    assert.equal(isDue(after, new Date(2026, 9, 8, 9, 30, 40)), false, "must not double-run in the same minute");
    assert.equal(isDue(after, new Date(2026, 9, 9, 9, 30, 0)), true, "next day should fire again");
  });
});

test("isDue is false for a disabled task and a non-matching minute", () => {
  withStore((path) => {
    const task = createSchedule({ prompt: "x", cwd: "/tmp", cron: "30 9 * * *" }, path);
    assert.equal(isDue(task, new Date(2026, 9, 8, 9, 31, 0)), false);
    updateSchedule(task.id, { enabled: false }, path);
    assert.equal(isDue(getSchedule(task.id, path), new Date(2026, 9, 8, 9, 30, 0)), false);
  });
});

test("a one-shot task fires late but only once, and switches itself off", () => {
  withStore((path) => {
    const at = new Date(Date.now() - 60000);
    const task = createSchedule({ prompt: "x", cwd: "/tmp", runOnceAt: at.toISOString() }, path);
    assert.equal(isDue(task), true, "a missed moment should still run when the process wakes");
    const after = recordRun(task.id, { sessionId: "s", at: new Date() }, path);
    assert.equal(after.enabled, false, "one-shot disables itself after running");
    assert.equal(isDue(after), false);
  });
});

test("recordRun keeps the error and does not overwrite an old session id with null", () => {
  withStore((path) => {
    const task = createSchedule({ prompt: "x", cwd: "/tmp", cron: "0 9 * * *" }, path);
    recordRun(task.id, { sessionId: "sess-1" }, path);
    const failed = recordRun(task.id, { error: "boom" }, path);
    assert.equal(failed.lastError, "boom");
    assert.equal(failed.lastSessionId, "sess-1");
    assert.equal(failed.runCount, 2);
    const ok = recordRun(task.id, { sessionId: "sess-2" }, path);
    assert.equal(ok.lastError, null, "a later success clears the error");
    assert.equal(ok.lastSessionId, "sess-2");
  });
});

test("a corrupt or partial file degrades to an empty list instead of throwing", () => {
  withStore((path) => {
    writeFileSync(path, "{ this is not json");
    assert.deepEqual(listSchedules(path), []);

    writeFileSync(path, JSON.stringify({ version: 1 }));
    assert.deepEqual(listSchedules(path), []);

    writeFileSync(path, JSON.stringify({ tasks: [{ id: "", prompt: "x" }] }));
    assert.deepEqual(listSchedules(path), [], "rows missing id/cwd are dropped");
  });
});

test("a task with an unparsable cron is kept but never fires", () => {
  withStore((path) => {
    writeFileSync(path, JSON.stringify({
      version: 1,
      tasks: [{
        id: "t1", prompt: "keep me", cwd: "/tmp", cron: "bogus",
        enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      }],
    }));
    const [task] = listSchedules(path);
    assert.equal(task.prompt, "keep me", "the user's text survives");
    assert.equal(task.enabled, false, "but it is inert");
    assert.equal(nextRunFor(task), null);
  });
});

// --- retention: finished one-shot tasks are swept, repeating ones never are ---

function seed(storePath, tasks) {
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks }));
}

function task(overrides) {
  return {
    id: overrides.id, prompt: "p", cwd: "/tmp", cron: "0 9 * * *", summary: "s",
    runOnceAt: null, enabled: true, createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z", lastRunAt: null, lastSessionId: null,
    lastError: null, runCount: 0, model: null, ...overrides,
  };
}

test("pruneFinishedTasks removes an old spent one-shot task", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "spent", runOnceAt: "2026-10-04T09:00:00Z", lastRunAt: "2026-10-04T09:00:00Z", runCount: 1, enabled: false }),
    ]);
    const removed = pruneFinishedTasks(3, now, path);
    assert.deepEqual(removed, ["spent"]);
    assert.equal(listSchedules(path).length, 0);
  });
});

test("pruneFinishedTasks keeps a spent one-shot task inside the window", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "recent", runOnceAt: "2026-10-07T09:00:00Z", lastRunAt: "2026-10-07T09:00:00Z", runCount: 1, enabled: false }),
    ]);
    assert.deepEqual(pruneFinishedTasks(3, now, path), []);
    assert.equal(listSchedules(path).length, 1);
  });
});

test("pruneFinishedTasks never removes a repeating task", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "daily", cron: "30 9 * * *", lastRunAt: "2025-01-01T09:00:00Z", runCount: 99 }),
    ]);
    assert.deepEqual(pruneFinishedTasks(3, now, path), []);
    assert.equal(listSchedules(path).length, 1, "a repeating task is still doing work");
  });
});

test("pruneFinishedTasks keeps a pending one-shot task however old it is", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "future", runOnceAt: "2027-06-01T09:00:00Z", createdAt: "2025-01-01T00:00:00Z", runCount: 0 }),
    ]);
    assert.deepEqual(pruneFinishedTasks(3, now, path), [], "it has not had its moment yet");
    assert.equal(listSchedules(path).length, 1);
  });
});

test("pruneFinishedTasks falls back to updatedAt when lastRunAt is missing", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "no-stamp", runOnceAt: "2026-09-01T09:00:00Z", lastRunAt: null, updatedAt: "2026-09-01T09:00:00Z", runCount: 1, enabled: false }),
    ]);
    assert.deepEqual(pruneFinishedTasks(3, now, path), ["no-stamp"]);
  });
});

test("pruneFinishedTasks with a non-positive window removes nothing", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "old", runOnceAt: "2020-01-01T09:00:00Z", lastRunAt: "2020-01-01T09:00:00Z", runCount: 1, enabled: false }),
    ]);
    assert.deepEqual(pruneFinishedTasks(0, now, path), []);
    assert.equal(listSchedules(path).length, 1, "0 means 'keep forever', not 'delete all'");
  });
});

test("pruneFinishedTasks can drop several rows at once", () => {
  withStore((path) => {
    const now = new Date("2026-10-08T12:00:00Z");
    seed(path, [
      task({ id: "a", runOnceAt: "2026-10-01T09:00:00Z", lastRunAt: "2026-10-01T09:00:00Z", runCount: 1, enabled: false }),
      task({ id: "keep-me", runOnceAt: "2026-10-07T09:00:00Z", lastRunAt: "2026-10-07T09:00:00Z", runCount: 1, enabled: false }),
      task({ id: "b", runOnceAt: "2026-09-20T09:00:00Z", lastRunAt: "2026-09-20T09:00:00Z", runCount: 1, enabled: false }),
    ]);
    const removed = pruneFinishedTasks(3, now, path);
    assert.deepEqual(removed.sort(), ["a", "b"]);
    assert.deepEqual(listSchedules(path).map((t) => t.id), ["keep-me"]);
  });
});
