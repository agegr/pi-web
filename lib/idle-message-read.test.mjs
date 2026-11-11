import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createIdleMessageReads, entriesAfter } = await jiti.import("./idle-message-read.ts");

const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };

// Reads held until the test releases them, in the order they started.
function harness({ wanted = () => true, pending = () => [] } = {}) {
  const reads = [];
  const errors = [];
  const request = createIdleMessageReads({
    pendingReads: (sid) => pending(sid),
    read: (sid) => {
      const gate = Promise.withResolvers();
      reads.push({ sid, gate });
      return gate.promise;
    },
    wanted,
    onError: (error) => errors.push(error),
  });
  const release = async (index, error) => {
    if (error) reads[index].gate.reject(error);
    else reads[index].gate.resolve();
    await settle();
  };
  return { request, reads, errors, release };
}

test("a burst during a read shares one more read after it", async () => {
  const h = harness();
  h.request("A");
  await settle();
  assert.equal(h.reads.length, 1);
  h.request("A");
  h.request("A");
  h.request("A");
  await settle();
  assert.equal(h.reads.length, 1, "nothing starts beside the read under way");
  await h.release(0);
  assert.deepEqual(h.reads.map((read) => read.sid), ["A", "A"]);
  await h.release(1);
  assert.equal(h.reads.length, 2, "the burst is answered; no read follows");
  h.request("A");
  await settle();
  assert.equal(h.reads.length, 3, "a later message reads again");
  await h.release(2);
});

test("a read of the session already under way is waited out first", async () => {
  const flight = Promise.withResolvers();
  let pending = [flight.promise, undefined];
  const h = harness({ pending: () => pending });
  h.request("A");
  await settle();
  assert.equal(h.reads.length, 0, "the read under way may hold an answer from before the message");
  pending = [];
  flight.reject(new Error("failed read"));
  await settle();
  assert.equal(h.reads.length, 1, "a read that failed is waited out too");
  await h.release(0);
  assert.deepEqual(h.errors, []);
});

test("a switched session or a started run stops the reads", async () => {
  let shown = "A";
  let running = false;
  const h = harness({ wanted: (sid) => sid === shown && !running });
  h.request("A");
  await settle();
  h.request("A");
  shown = "B";
  h.request("B");
  await h.release(0);
  assert.deepEqual(h.reads.map((read) => read.sid), ["A", "B"], "A is not read again once B shows");
  await h.release(1);

  h.request("B");
  await settle();
  h.request("B");
  running = true;
  await h.release(2);
  assert.equal(h.reads.length, 3, "a run started: its own reads show the messages");

  const flight = Promise.withResolvers();
  running = false;
  const waited = harness({ wanted: () => !running, pending: () => [flight.promise] });
  waited.request("B");
  await settle();
  running = true;
  flight.resolve();
  await settle();
  assert.equal(waited.reads.length, 0, "a run that starts while a read is waited out stops it too");
});

test("a read that fails leaves later messages their reads", async () => {
  const h = harness();
  h.request("A");
  await settle();
  h.request("A");
  await h.release(0, new Error("HTTP 500"));
  assert.equal(h.errors.length, 1);
  assert.equal(h.reads.length, 2, "the message that arrived meanwhile still reads");
  await h.release(1);
  h.request("A");
  await settle();
  assert.equal(h.reads.length, 3);
  await h.release(2);
});

test("entriesAfter gives what a tail read holds after the window's last entry", () => {
  const tail = { messages: ["a", "c1", "c2"], entryIds: ["e1", "e2", "e3"] };
  assert.deepEqual(entriesAfter("e2", tail), { messages: ["c2"], entryIds: ["e3"] });
  assert.deepEqual(entriesAfter("e3", tail), { messages: [], entryIds: [] }, "nothing new: a read landed first");
  assert.equal(entriesAfter("e0", tail), null, "the read starts after the window: only a full read can tell");
});
