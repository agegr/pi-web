import assert from "node:assert/strict";
import test from "node:test";
import { createMessageUpdateCoalescer } from "./event-coalescer.ts";

function collector() {
  const events = [];
  return { events, emit: (e) => events.push(e) };
}

const update = (text) => ({ type: "message_update", message: { text } });

test("buffers a message_update until flushed", () => {
  const { events, emit } = collector();
  const c = createMessageUpdateCoalescer(emit);

  c.push(update("a"));
  assert.equal(events.length, 0);
  assert.equal(c.hasPending(), true);

  c.flush();
  assert.deepEqual(events, [update("a")]);
  assert.equal(c.hasPending(), false);
});

test("coalesces consecutive updates to only the latest", () => {
  const { events, emit } = collector();
  const c = createMessageUpdateCoalescer(emit);

  c.push(update("a"));
  c.push(update("ab"));
  c.push(update("abc"));
  c.flush();

  assert.deepEqual(events, [update("abc")]);
});

test("flushes the pending update before a following non-update event, in order", () => {
  const { events, emit } = collector();
  const c = createMessageUpdateCoalescer(emit);

  c.push(update("a"));
  c.push(update("ab"));
  c.push({ type: "agent_end" });

  assert.deepEqual(events, [update("ab"), { type: "agent_end" }]);
  assert.equal(c.hasPending(), false);
});

test("passes non-update events straight through", () => {
  const { events, emit } = collector();
  const c = createMessageUpdateCoalescer(emit);

  c.push({ type: "tool_execution_start", id: "1" });
  assert.deepEqual(events, [{ type: "tool_execution_start", id: "1" }]);
  assert.equal(c.hasPending(), false);
});

test("flush is a no-op when nothing is pending", () => {
  const { events, emit } = collector();
  const c = createMessageUpdateCoalescer(emit);

  c.flush();
  assert.deepEqual(events, []);
});
