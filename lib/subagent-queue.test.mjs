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

test("a failed initial queued status does not leave work that a later dispatch can start", async () => {
  const queue = new SubagentQueue();
  let orphanStarts = 0;
  assert.throws(() => queue.enqueue("parent", 1, async () => { orphanStarts++; }, () => {
    throw new Error("queued status failed");
  }), /queued status failed/);
  const next = queue.enqueue("parent", 1, async () => "next", () => {});
  assert.equal(await next.promise, "next");
  assert.equal(orphanStarts, 0);
});

test("a failed running status rejects that item without blocking later queued work", async () => {
  const queue = new SubagentQueue();
  let release;
  const first = queue.enqueue("parent", 1, () => new Promise((resolve) => { release = resolve; }), () => {});
  let failedStarts = 0;
  const failed = queue.enqueue("parent", 1, async () => { failedStarts++; }, (state) => {
    if (state === "running") throw new Error("running status failed");
  });
  const rejected = assert.rejects(failed.promise, /running status failed/);
  const next = queue.enqueue("parent", 1, async () => "next", () => {});
  release();
  await first.promise;
  await rejected;
  assert.equal(await next.promise, "next");
  assert.equal(failedStarts, 0);
});
