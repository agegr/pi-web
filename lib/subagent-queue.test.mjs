import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { SubagentQueue } = await createJiti(import.meta.url).import("./subagent-queue.ts");

test("runs FIFO with a per-parent concurrency limit and drains after completion", async () => {
  const queue = new SubagentQueue();
  const events = [];
  let release;
  const first = queue.enqueue("parent", 1, () => new Promise((resolve) => { release = () => resolve("first"); }), (state) => events.push(["first", state]));
  const second = queue.enqueue("parent", 1, async () => "second", (state) => events.push(["second", state]));
  assert.deepEqual(events, [["first", "queued"], ["first", "running"], ["second", "queued"]]);
  release();
  assert.equal(await first.promise, "first");
  assert.equal(await second.promise, "second");
  assert.deepEqual(events, [
    ["first", "queued"], ["first", "running"], ["second", "queued"], ["second", "running"],
  ]);
});

test("cancels queued work without starting it", async () => {
  const queue = new SubagentQueue();
  let release;
  const first = queue.enqueue("parent", 1, () => new Promise((resolve) => { release = resolve; }), () => {});
  let started = false;
  let cancelled = false;
  const second = queue.enqueue("parent", 1, async () => { started = true; return "bad"; }, () => {}, () => { cancelled = true; });
  assert.equal(second.cancel(), true);
  assert.equal(cancelled, true);
  release();
  await first.promise;
  assert.equal(await second.promise, undefined);
  assert.equal(started, false);
});

test("a status write that throws leaves no queued item behind and a failed start frees its slot", async () => {
  const queue = new SubagentQueue();
  let orphanRan = false;
  assert.throws(() => queue.enqueue("parent", 1, async () => { orphanRan = true; }, (state) => {
    if (state === "queued") throw new Error("ENOSPC");
  }), /ENOSPC/);

  const failed = queue.enqueue("parent", 1, async () => "never", (state) => {
    if (state === "running") throw new Error("ENOSPC");
  });
  await assert.rejects(failed.promise, /ENOSPC/);
  assert.equal(await queue.enqueue("parent", 1, async () => "next", () => {}).promise, "next");
  assert.equal(orphanRan, false);
});
