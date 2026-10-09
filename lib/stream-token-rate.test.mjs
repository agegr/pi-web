import assert from "node:assert/strict";
import test from "node:test";

const { streamRateKey, streamRateStart, streamTokensPerSecond } = await import("./stream-token-rate.ts");

const reply = (timestamp, model = "m") => ({ provider: "p", model, timestamp });

test("a reply's rate keeps its first-token start when the chat remounts", () => {
  const key = streamRateKey(reply(1_000));
  const start = streamRateStart(key, 20, 10_000);
  assert.equal(streamTokensPerSecond(start, 520, 20_000), 50);
  // Back from another session 20 s later: the view is new, the reply is not.
  const remounted = streamRateStart(key, 1_520, 30_000);
  assert.deepEqual(remounted, { at: 10_000, tokens: 20 });
  assert.equal(streamTokensPerSecond(remounted, 1_520, 30_000), 75);
});

test("joining a reply with no record times only the tokens that follow", () => {
  const start = streamRateStart(streamRateKey(reply(2_000)), 3_000, 50_000);
  assert.equal(streamTokensPerSecond(start, 3_000, 50_400), null);
  assert.equal(streamTokensPerSecond(start, 3_100, 51_000), 100);
});

test("replies are told apart by their request time and model", () => {
  assert.notEqual(streamRateKey(reply(3_000)), streamRateKey(reply(3_001)));
  assert.notEqual(streamRateKey(reply(3_000, "a")), streamRateKey(reply(3_000, "b")));
  assert.equal(streamRateKey({ provider: "p", model: "m" }), null);
  const unkeyed = streamRateStart(null, 10, 0);
  assert.notEqual(streamRateStart(null, 10, 0), unkeyed);
});

test("only the newest replies are remembered", () => {
  const first = streamRateKey(reply(4_000));
  streamRateStart(first, 1, 0);
  for (let i = 1; i <= 32; i++) streamRateStart(streamRateKey(reply(4_000 + i)), 1, 0);
  assert.deepEqual(streamRateStart(first, 7, 99), { at: 99, tokens: 7 });
});
