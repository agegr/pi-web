import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const {
  MESSAGE_THINKING_CUSTOM_TYPE,
  normalizeMessageThinkingLabel,
  readCurrentMessageThinkingLabel,
  readMessageThinkingLevels,
  messageThinkingLevel,
  withMessageThinking,
} = await jiti.import("./message-thinking.ts");
const { streamReducer, INITIAL_STREAMING_STATE } = await jiti.import("./streaming-message.ts");

const at = (time) => new Date(time).toISOString();
const change = (id, parentId, thinkingLevel, time = 0) => ({
  id, parentId, type: "thinking_level_change", thinkingLevel, timestamp: at(time),
});
const answer = (id, parentId, time = 100, extra = {}) => ({
  id, parentId, type: "message", timestamp: at(time + 10),
  message: { role: "assistant", provider: "test", model: "gpt-6-astra", timestamp: time, content: [{ type: "text", text: id }], ...extra },
});
const display = (id, parentId, label, time = 0) => ({
  id, parentId, type: "custom", customType: MESSAGE_THINKING_CUSTOM_TYPE,
  timestamp: at(time), data: { version: 1, label },
});

test("each historical answer keeps the level on its own branch after later changes", () => {
  const entries = [
    change("high", null, "high"), answer("a1", "high"),
    change("medium", "a1", "medium", 200), answer("a2", "medium", 300),
    change("low", "a1", "low", 400), answer("other", "low", 500),
    change("xhigh", "a2", "xhigh", 600),
  ];
  const context = buildSessionContext(entries, "xhigh");
  assert.equal(context.thinkingLevel, "xhigh");
  assert.deepEqual(context.entryIds, ["a1", "a2"]);
  assert.deepEqual(context.messages.map((message) => message.thinkingLevel), ["high", "medium"]);
  assert.deepEqual(buildSessionContext(entries, "other").messages.map((message) => message.thinkingLevel), ["high", "low"]);
  assert.equal(entries[1].message.thinkingLevel, undefined, "reading does not mutate stored legacy messages");
});

test("paged and compacted history recovers settings from before the requested page", () => {
  const entries = [change("setting", null, "high"), answer("a1", "setting")];
  entries.push({ type: "compaction", id: "compact", parentId: "a1", timestamp: at(200), summary: "kept", tokensBefore: 500, firstKeptEntryId: "a1" });
  entries.push(answer("a2", "compact", 300), change("off", "a2", "off", 400), answer("a3", "off", 500));
  const latest = buildSessionContext(entries, "a3", { tail: 1 });
  assert.equal(latest.messages[0].thinkingLevel, "off");
  const older = buildSessionContext(entries, latest.oldestEntryId, { tail: 3, excludeLeaf: true, deferThinking: true });
  assert.deepEqual(older.entryIds, ["compact", "a2"]);
  assert.equal(older.messages[1].thinkingLevel, "high");
  assert.deepEqual(buildSessionContext(entries, null).messages, []);
});

test("labels use the selected setting rather than provider-native effort names", () => {
  const entries = [
    change("setting", null, "medium"),
    answer("captured", "setting", 100, { thinkingLevel: "high" }),
    answer("native", "captured", 200, { thinkingLevel: "xhigh", providerThinkingLevel: "ultra" }),
  ];
  assert.deepEqual(buildSessionContext(entries).messages.map((message) => message.thinkingLevel), ["high", "xhigh"]);
  assert.equal(messageThinkingLevel({ thinkingLevel: "auto" }, "high"), "auto");
});

test("accepted prompt metadata preserves auto and provider-mapped labels", () => {
  const entries = [
    change("high", null, "high"),
    display("mapped", "high", "xhigh", 50),
    answer("mapped-answer", "mapped", 100),
    change("still-high", "mapped-answer", "high", 200),
    display("automatic", "still-high", "auto", 250),
    answer("auto-answer", "automatic", 300),
  ];
  assert.deepEqual(
    buildSessionContext(entries).messages.map((message) => message.thinkingLevel),
    ["xhigh", "auto"],
  );
  assert.equal(readCurrentMessageThinkingLabel(entries), "auto");
  assert.equal(normalizeMessageThinkingLabel(" xhigh "), "xhigh");
  assert.throws(() => normalizeMessageThinkingLabel("bad\nlabel"), /Invalid message thinking label/);
});

test("malformed custom labels are ignored and later setting changes clear stale labels", () => {
  const entries = [
    display("bad", null, " ", 10),
    change("high", "bad", "high", 20),
    display("valid", "high", "mapped-high", 30),
    answer("mapped", "valid", 40),
    change("low", "mapped", "low", 50),
    answer("fallback", "low", 60),
  ];
  assert.deepEqual(
    buildSessionContext(entries).messages.map((message) => message.thinkingLevel),
    ["mapped-high", "low"],
  );
  assert.equal(readCurrentMessageThinkingLabel(entries), undefined);
});

test("unknown older settings stay absent and a selected auto label stays auto", () => {
  const entries = [answer("old", null), change("auto", "old", "auto", 200), answer("automatic", "auto", 300)];
  const context = buildSessionContext(entries);
  assert.deepEqual(context.messages.map((message) => message.thinkingLevel), [undefined, "auto"]);
  assert.equal(messageThinkingLevel({ thinkingLevel: " " }), undefined);
});

test("legacy responses use their start time when the user changed effort during generation", () => {
  const entries = [
    change("high", null, "high", 100), change("medium", "high", "medium", 300),
    answer("long", "medium", 200), answer("next", "long", 400),
  ];
  assert.deepEqual(buildSessionContext(entries).messages.map((message) => message.thinkingLevel), ["high", "medium"]);
});

test("deep histories resolve iteratively and broken ancestry remains unknown", () => {
  const entries = [change("start", null, "high")];
  for (let i = 0; i < 5000; i += 1) entries.push(answer(`a${i}`, entries.at(-1).id, i + 100));
  assert.equal(readMessageThinkingLevels(entries, ["a4999"]).get("a4999"), "high");
  const detached = answer("detached", "missing");
  assert.equal(readMessageThinkingLevels([...entries, detached], ["detached"]).get("detached"), undefined);
});

test("stream deltas and refreshed snapshots retain the per-message effort", () => {
  const received = answer("live", null, 100).message;
  const message = withMessageThinking(received, "high");
  assert.equal(received.thinkingLevel, undefined, "display annotation does not change the received message");
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "snapshot", message });
  state = streamReducer(state, { type: "delta", event: { type: "text_delta", contentIndex: 0, delta: " text" } });
  assert.equal(state.streamingMessage.thinkingLevel, "high");
  state = streamReducer(state, { type: "snapshot", message: { ...message, content: [{ type: "text", text: "refreshed" }] } });
  assert.equal(state.streamingMessage.thinkingLevel, "high");
});
