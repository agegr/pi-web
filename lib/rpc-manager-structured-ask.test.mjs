import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

const ASK_ARGS = {
  question: "Which path?",
  options: ["Path A", { title: "Path B", description: "Slower" }],
  allowComment: true,
};

function setup(t, handler = async () => {}) {
  let ui;
  const inner = {
    sessionId: "structured-ask-test",
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() {},
    prompt: AgentSession.prototype.prompt,
    _tryExecuteExtensionCommand: AgentSession.prototype._tryExecuteExtensionCommand,
    abort: AgentSession.prototype.abort,
    waitForIdle: AgentSession.prototype.waitForIdle,
    _extensionRunner: {
      getCommand: () => ({ handler: () => handler(ui) }),
      createCommandContext: () => ({}),
      emitError: () => {},
    },
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  ui = wrapper.createExtensionUiContext();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, events };
}

/** Mimics the tool-execution event the wrapper tracks while a tool runs. */
function runningAskTool(wrapper, args = ASK_ARGS) {
  wrapper.activeToolEvents.set("call-1", {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "ask_user",
    args,
  });
}

/**
 * Starts the extension command that opens the custom UI. The returned promise
 * is deliberately not awaited here: it settles only once the question is
 * answered.
 */
function openCustomUi(wrapper) {
  return wrapper.send({ type: "prompt", message: "/ask" });
}

test("attaches the structured question to the custom UI request", async (t) => {
  const results = [];
  const { wrapper, events } = setup(t, async (ui) => {
    results.push(await ui.custom(() => ({ render: () => ["Choose"] })));
  });
  runningAskTool(wrapper);
  const sending = openCustomUi(wrapper);
  await nextTurn();

  const request = events.find((event) => event.method === "custom");
  assert.equal(request.ask.toolName, "ask_user");
  assert.equal(request.ask.question, "Which path?");
  assert.deepEqual(request.ask.options, [{ title: "Path A" }, { title: "Path B", description: "Slower" }]);
  assert.equal(request.ask.allowComment, true);

  await wrapper.send({
    type: "extension_ui_ask_response",
    id: request.id,
    answer: { kind: "selection", selections: ["Path B"], comment: "ship it" },
  });
  await sending;
  assert.deepEqual(results[0], { kind: "selection", selections: ["Path B"], comment: "ship it" });
  assert.equal(wrapper.activeCustomUis.size, 0);
});

test("a dismissed question resolves the extension with a cancel", async (t) => {
  const results = [];
  const { wrapper, events } = setup(t, async (ui) => {
    results.push(await ui.custom(() => ({ render: () => ["Choose"] })));
  });
  runningAskTool(wrapper);
  const sending = openCustomUi(wrapper);
  await nextTurn();

  const request = events.find((event) => event.method === "custom");
  await wrapper.send({ type: "extension_ui_ask_response", id: request.id, cancelled: true });
  await sending;
  assert.equal(results[0], null);
});

test("a submission that does not fit the question leaves it open", async (t) => {
  const results = [];
  const { wrapper, events } = setup(t, async (ui) => {
    results.push(await ui.custom(() => ({ render: () => ["Choose"] })));
  });
  runningAskTool(wrapper);
  const sending = openCustomUi(wrapper);
  await nextTurn();
  const request = events.find((event) => event.method === "custom");

  await wrapper.send({
    type: "extension_ui_ask_response",
    id: request.id,
    answer: { kind: "selection", selections: ["Path C"] },
  });
  await nextTurn();
  assert.equal(results.length, 0);
  assert.equal(wrapper.activeCustomUis.size, 1);

  // The terminal path still works while the question is open.
  await wrapper.send({ type: "extension_ui_ask_response", id: request.id, cancelled: true });
  await sending;
  assert.equal(results[0], null);
});

test("leaves unknown custom UIs on the terminal path", async (t) => {
  const results = [];
  const { wrapper, events } = setup(t, async (ui) => {
    results.push(await ui.custom(() => ({ render: () => ["Choose"] })));
  });
  // A tool the adapter does not know about, plus an ask_user call with no options.
  wrapper.activeToolEvents.set("call-2", {
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "bash",
    args: { command: "ls" },
  });
  runningAskTool(wrapper, { question: "Free text?" });
  const sending = openCustomUi(wrapper);
  await nextTurn();

  const request = events.find((event) => event.method === "custom");
  assert.equal(request.ask, undefined);
  await wrapper.send({
    type: "extension_ui_ask_response",
    id: request.id,
    answer: { kind: "freeform", text: "hi" },
  });
  await nextTurn();
  assert.equal(results.length, 0);

  wrapper.closeCustomUi(request.id, null);
  await sending;
});
