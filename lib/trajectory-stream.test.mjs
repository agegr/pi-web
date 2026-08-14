import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { wrapTrajectoryStream } = await jiti.import("./trajectory-stream.ts");
const { createAssistantMessageEventStream } = await jiti.import("@earendil-works/pi-ai");

const assistant = { role: "assistant", content: [], model: "m", provider: "p" };

function makeBase(events) {
  return () => {
    const stream = createAssistantMessageEventStream();
    for (const event of events) stream.push(event);
    stream.end(assistant);
    return stream;
  };
}

const EVENTS = [
  { type: "start", partial: assistant },
  { type: "text_start", contentIndex: 0, partial: assistant },
  { type: "text_delta", contentIndex: 0, delta: "ok", partial: assistant },
  { type: "text_delta", contentIndex: 0, delta: " more", partial: assistant },
  { type: "text_end", contentIndex: 0, content: "ok more", partial: assistant },
  { type: "done", reason: "stop", message: assistant },
];

function makeHooks() {
  const calls = { starts: 0, firstTokens: 0, finishes: [] };
  return {
    calls,
    hooks: {
      startRequest: () => {
        calls.starts += 1;
        return "req-1";
      },
      firstToken: () => {
        calls.firstTokens += 1;
      },
      finishRequest: (id, status, result) => {
        calls.finishes.push({ id, status, result });
      },
    },
  };
}

test("records one start, one first token, and completion", async () => {
  const { calls, hooks } = makeHooks();
  const wrapped = wrapTrajectoryStream(makeBase(EVENTS), hooks);
  const seen = [];
  for await (const event of wrapped(null, {}, {})) seen.push(event);
  assert.equal(calls.starts, 1);
  assert.equal(calls.firstTokens, 1);
  assert.equal(calls.finishes.length, 1);
  assert.equal(calls.finishes[0].status, "complete");
  assert.equal(calls.finishes[0].result, assistant);
  assert.deepEqual(seen.map((e) => e.type), EVENTS.map((e) => e.type));
});

test("marks first token only once across thinking and text deltas", async () => {
  const { calls, hooks } = makeHooks();
  const events = [
    { type: "thinking_start", contentIndex: 0, partial: assistant },
    { type: "thinking_delta", contentIndex: 0, delta: "hmm", partial: assistant },
    { type: "thinking_delta", contentIndex: 0, delta: " more", partial: assistant },
    { type: "text_start", contentIndex: 1, partial: assistant },
    { type: "text_delta", contentIndex: 1, delta: "ok", partial: assistant },
  ];
  const wrapped = wrapTrajectoryStream(makeBase(events), hooks);
  for await (const event of wrapped(null, {}, {})) {
    // consume
  }
  assert.equal(calls.firstTokens, 1);
});

test("tool-call delta also counts as the first token", async () => {
  const { calls, hooks } = makeHooks();
  const events = [
    { type: "toolcall_start", contentIndex: 0, partial: assistant },
    { type: "toolcall_delta", contentIndex: 0, delta: "{}", partial: assistant },
  ];
  const wrapped = wrapTrajectoryStream(makeBase(events), hooks);
  for await (const event of wrapped(null, {}, {})) {
    // consume
  }
  assert.equal(calls.firstTokens, 1);
});

test("records an error when the provider stream throws", async () => {
  const { calls, hooks } = makeHooks();
  const throwingBase = () => ({
    [Symbol.asyncIterator]() {
      return {
        next() {
          throw new Error("provider down");
        },
      };
    },
  });
  const wrapped = wrapTrajectoryStream(throwingBase, hooks);
  const seen = [];
  for await (const event of wrapped(null, {}, {})) seen.push(event);
  assert.equal(calls.finishes.length, 1);
  assert.equal(calls.finishes[0].status, "error");
  assert.ok(calls.finishes[0].result instanceof Error);
  assert.equal(seen.length, 0);
});

test("the wrapped stream still exposes result()", async () => {
  const { hooks } = makeHooks();
  const wrapped = wrapTrajectoryStream(makeBase(EVENTS), hooks);
  const stream = wrapped(null, {}, {});
  await stream[Symbol.asyncIterator]().next();
  const result = await stream.result();
  assert.equal(result, assistant);
});
