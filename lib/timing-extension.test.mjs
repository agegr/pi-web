import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createTimingExtension } = await jiti.import("./timing-extension.ts");
const { PI_WEB_TIMING_CUSTOM_TYPE } = await jiti.import("./session-timing.ts");

function assistantMessage(extra = {}) {
  return {
    role: "assistant",
    content: [],
    api: "test",
    provider: "test-provider",
    model: "test-model",
    usage: { input: 10, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 310, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1700000000000,
    ...extra,
  };
}

function harness() {
  const handlers = new Map();
  const appended = [];
  let currentTime = 0;
  const extension = createTimingExtension(() => currentTime);
  extension.factory({
    on(event, handler) {
      handlers.set(event, handler);
    },
    appendEntry(customType, data) {
      appended.push({ customType, data });
    },
  });
  const emit = (event, payload) => handlers.get(event)?.(payload, {});
  return {
    appended,
    emit,
    at(ms) {
      currentTime = ms;
    },
    get last() {
      return appended[appended.length - 1];
    },
  };
}

test("measures TTFT and decode time across a full request", () => {
  const h = harness();
  h.at(1000);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.emit("message_start", { type: "message_start", message: assistantMessage() });
  h.at(1500);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "H", partial: assistantMessage() },
  });
  // Later updates must not move the TTFT anchor.
  h.at(2000);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "i", partial: assistantMessage() },
  });
  h.at(3000);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });

  assert.equal(h.appended.length, 1);
  assert.equal(h.last.customType, PI_WEB_TIMING_CUSTOM_TYPE);
  assert.equal(h.last.data.ttftMs, 500);
  assert.equal(h.last.data.decodeMs, 1500);
  assert.equal(h.last.data.outputTokens, 300);
  assert.equal(h.last.data.model, "test-model");
  assert.equal(h.last.data.provider, "test-provider");
});

test("counts a thinking delta as the first token", () => {
  const h = harness();
  h.at(100);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(400);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hmm", partial: assistantMessage() },
  });
  h.at(900);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });
  assert.equal(h.last.data.ttftMs, 300);
  assert.equal(h.last.data.decodeMs, 500);
});

test("ignores structural start frames and empty deltas", () => {
  const h = harness();
  h.at(1000);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(1200);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: assistantMessage() },
  });
  h.at(1300);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "", partial: assistantMessage() },
  });
  h.at(2000);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });

  // No token ever arrived, so there is no honest TTFT to report.
  assert.equal(h.last.data.ttftMs, null);
  assert.equal(h.last.data.decodeMs, 0);
  assert.equal(h.last.data.outputTokens, 300);
});

test("keeps TTFT but drops decode data for aborted requests", () => {
  const h = harness();
  h.at(0);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(200);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial: assistantMessage() },
  });
  h.at(800);
  h.emit("message_end", { type: "message_end", message: assistantMessage({ stopReason: "aborted" }) });

  assert.equal(h.last.data.ttftMs, 200);
  assert.equal(h.last.data.decodeMs, 0);
  assert.equal(h.last.data.outputTokens, 0);
  assert.equal(h.last.data.stopReason, "aborted");
});

test("falls back to the message start stamp without a provider hook", () => {
  const h = harness();
  h.at(5000);
  h.emit("message_start", { type: "message_start", message: assistantMessage() });
  h.at(5600);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "a", partial: assistantMessage() },
  });
  h.at(6000);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });
  assert.equal(h.last.data.ttftMs, 600);
});

test("resets the anchor between requests", () => {
  const h = harness();
  h.at(0);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(100);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "a", partial: assistantMessage() },
  });
  h.at(200);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });

  h.at(100000);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(100750);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "b", partial: assistantMessage() },
  });
  h.at(101000);
  h.emit("message_end", { type: "message_end", message: assistantMessage() });

  assert.equal(h.appended.length, 2);
  assert.equal(h.appended[0].data.ttftMs, 100);
  assert.equal(h.appended[1].data.ttftMs, 750);
  assert.equal(h.appended[1].data.decodeMs, 250);
});

test("ignores non-assistant messages", () => {
  const h = harness();
  h.emit("message_end", {
    type: "message_end",
    message: { role: "user", content: "hi", timestamp: 0 },
  });
  h.emit("message_end", {
    type: "message_end",
    message: { role: "toolResult", toolCallId: "1", toolName: "bash", content: [], isError: false, timestamp: 0 },
  });
  assert.equal(h.appended.length, 0);
});

test("records the assistant message timestamp as the correlation key", () => {
  const h = harness();
  h.at(1000);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(1500);
  h.emit("message_update", {
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "H", partial: assistantMessage() },
  });
  h.at(3000);
  h.emit("message_end", {
    type: "message_end",
    message: assistantMessage({ timestamp: 1770000000123, responseId: "resp_abc" }),
  });

  assert.equal(h.last.data.messageTimestamp, 1770000000123);
  assert.equal(h.last.data.responseId, "resp_abc");
});

test("omits the correlation key when the message has no timestamp", () => {
  const h = harness();
  h.at(10);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(20);
  h.emit("message_end", { type: "message_end", message: assistantMessage({ timestamp: undefined }) });

  assert.equal("messageTimestamp" in h.last.data, false);
  assert.equal("responseId" in h.last.data, false);
});

test("still records an entry when a request streams nothing", () => {
  const h = harness();
  h.at(10);
  h.emit("before_provider_request", { type: "before_provider_request", payload: {} });
  h.at(20);
  h.emit("message_end", { type: "message_end", message: assistantMessage({ usage: undefined }) });

  assert.equal(h.appended.length, 1);
  assert.equal(h.last.data.ttftMs, null);
  assert.equal(h.last.data.decodeMs, 0);
  assert.equal(h.last.data.outputTokens, 0);
});
