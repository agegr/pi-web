import assert from "node:assert/strict";
import test from "node:test";

const {
  AGENT_HOST_PROTOCOL_VERSION,
  createFrameReader,
  decodeFrames,
  encodeFrame,
} = await import("./agent-host-protocol.ts");

test("round-trips a frame through encode and decode", () => {
  const frame = { type: "command", id: "7", command: { type: "get_state" } };
  const { frames, rest } = decodeFrames(encodeFrame(frame));
  assert.deepEqual(frames, [frame]);
  assert.equal(rest, "");
});

test("keeps a partial frame until its newline arrives", () => {
  const first = decodeFrames('{"type":"hello","proto');
  assert.deepEqual(first.frames, []);
  assert.equal(first.rest, '{"type":"hello","proto');

  const second = decodeFrames(`${first.rest}col":1}\n{"type":"snapshot"}`);
  assert.deepEqual(second.frames, [{ type: "hello", protocol: 1 }]);
  assert.equal(second.rest, '{"type":"snapshot"}');
});

test("does not split on U+2028 or U+2029 inside a JSON string", () => {
  // A generic line reader would break the frame here; JSON allows both
  // characters unescaped, and a session event can carry them in message text.
  const event = { type: "event", event: { type: "message_update", text: "before\u2028after\u2029end" } };
  const encoded = encodeFrame(event);
  assert.equal(encoded.split("\n").length, 2, "the frame must hold exactly one newline");

  const { frames } = decodeFrames(encoded);
  assert.deepEqual(frames, [event]);
});

test("drops a malformed line without losing the frames around it", () => {
  const { frames } = decodeFrames('{"type":"hello"}\nnot json at all\n{"type":"snapshot","state":null}\n');
  assert.deepEqual(frames, [{ type: "hello" }, { type: "snapshot", state: null }]);
});

test("the reader carries a frame across chunks and reports each one once", () => {
  const seen = [];
  const read = createFrameReader((frame) => seen.push(frame));
  read('{"type":"hel');
  read('lo","protocol":1}\n{"type":"snapshot"');
  assert.deepEqual(seen, [{ type: "hello", protocol: 1 }]);
  read(',"state":{"isBashRunning":true}}\n');
  assert.deepEqual(seen, [
    { type: "hello", protocol: 1 },
    { type: "snapshot", state: { isBashRunning: true } },
  ]);
});

test("the protocol version is part of the wire contract", () => {
  assert.equal(AGENT_HOST_PROTOCOL_VERSION, 1);
});
