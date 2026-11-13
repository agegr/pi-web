import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// #1678: an extension whose session_start asks a dialog. The dialog reaches the page only
// through the event stream, which a fresh composer opens once /api/agent/new has answered
// with get_state, so get_state must not wait for that session_start.

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, sessionStart) {
  const order = [];
  const inner = {
    sessionId: "session-start-dialog",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    model: { provider: "test", id: "before" },
    agent: { state: { thinkingLevel: "low" } },
    systemPrompt: "",
    sessionManager: { getCwd: () => process.cwd(), getSessionName: () => undefined, getEntries: () => [] },
    extensionRunner: { async emit(event) { order.push(event.type); } },
    async bindExtensions({ uiContext }) {
      await sessionStart(uiContext, inner);
      order.push("bound");
    },
    subscribe() { return () => {}; },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    clearQueue: () => ({ steering: [], followUp: [] }),
    prompt: async (_message, options) => {
      order.push("prompt");
      options.preflightResult("started");
    },
    dispose() { order.push("dispose"); },
  };
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding();
  const dialog = () => events.find((event) => event.type === "extension_ui_request" && event.method === "confirm");
  return { inner, wrapper, order, events, dialog };
}

test("get_state answers while session_start waits on a dialog, and the dialog completes the binding", async (t) => {
  let answer;
  const f = fixture(t, async (ui, inner) => {
    await new Promise((resolve) => setImmediate(resolve));
    answer = await ui.confirm("Use project defaults?", "Asked at session_start");
    // A handler may pick the model once it has its answer.
    if (answer) inner.model = { provider: "test", id: "after" };
  });

  // Sent before the dialog exists, as /api/agent/new does right after the start.
  const state = await f.wrapper.send({ type: "get_state" });
  assert.ok(f.dialog(), "get_state answered only once the dialog was asked");
  assert.deepEqual(state.model, { id: "before", provider: "test" });
  assert.equal(state.thinkingLevel, "low");
  assert.equal(f.order.includes("bound"), false);

  // A later get_state while the dialog is still open answers at once too.
  assert.deepEqual((await f.wrapper.send({ type: "get_state" })).model, { id: "before", provider: "test" });

  // A prompt still waits for session_start.
  let promptSettled = false;
  const prompt = f.wrapper.send({ type: "prompt", message: "hi" }).then(() => { promptSettled = true; });
  await nextTurn();
  assert.equal(promptSettled, false);
  assert.equal(f.order.includes("prompt"), false);

  await f.wrapper.send({ type: "extension_ui_response", id: f.dialog().id, confirmed: true });
  await prompt;
  assert.equal(answer, true);
  assert.deepEqual(f.order, ["bound", "prompt"]);
  assert.deepEqual((await f.wrapper.send({ type: "get_state" })).model, { id: "after", provider: "test" });
});

test("get_state still waits for a session_start that asks nothing, or only notifies", async (t) => {
  let finish;
  const f = fixture(t, async (ui, inner) => {
    ui.notify("Starting", "info");
    await new Promise((resolve) => { finish = resolve; });
    inner.model = { provider: "test", id: "after" };
  });
  let settled = false;
  const state = f.wrapper.send({ type: "get_state" }).then((value) => {
    settled = true;
    return value;
  });
  await nextTurn();
  await nextTurn();
  assert.equal(settled, false);
  finish();
  assert.deepEqual((await state).model, { id: "after", provider: "test" });
});

test("shutdown of a wrapper whose session_start waits on a dialog cancels the dialog and completes", async (t) => {
  let answer = "unanswered";
  const f = fixture(t, async (ui) => {
    answer = await ui.confirm("Use project defaults?", "Asked at session_start");
  });
  await f.wrapper.send({ type: "get_state" });
  assert.ok(f.dialog());
  assert.equal(f.wrapper.isAlive(), true);

  await f.wrapper.shutdown();

  // The answer a closed dialog gets; session_start finished before session_shutdown.
  assert.equal(answer, false);
  assert.ok(f.events.some((event) => event.type === "extension_ui_closed" && event.id === f.dialog().id));
  assert.deepEqual(f.order, ["bound", "session_shutdown", "dispose"]);
  assert.equal(f.wrapper.isAlive(), false);
});

test("shutdown gives a session_start that never finishes the hooks' deadline, then shuts down", async (t) => {
  const previousValue = process.env.PI_WEB_SHUTDOWN_DEADLINE_MS;
  process.env.PI_WEB_SHUTDOWN_DEADLINE_MS = "250";
  try {
    const freshJiti = createJiti(import.meta.url, { moduleCache: false });
    const { AgentSessionWrapper: FreshWrapper } = await freshJiti.import("./rpc-manager.ts");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const warn = t.mock.method(console, "warn", () => {});
    const order = [];
    let asked = 0;
    const inner = {
      sessionId: "session-start-hang",
      sessionFile: "",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      agent: { state: {} },
      sessionManager: { getCwd: () => process.cwd(), getSessionName: () => undefined, getEntries: () => [] },
      extensionRunner: { async emit(event) { order.push(event.type); } },
      // Asks again whatever the answer, so cancelling the open dialog alone never ends it.
      async bindExtensions({ uiContext }) {
        try {
          for (;;) {
            asked += 1;
            await uiContext.confirm("Again?", "");
          }
        } catch (error) {
          order.push(`refused: ${error.message}`);
        }
      },
      subscribe() { return () => {}; },
      dispose() { order.push("dispose"); },
    };
    const wrapper = new FreshWrapper(inner);
    wrapper.start();
    wrapper.beginExtensionBinding();
    await nextTurn();
    assert.equal(asked, 1);

    const shutting = wrapper.shutdown();
    await nextTurn();
    assert.equal(asked, 2);
    t.mock.timers.tick(249);
    await nextTurn();
    assert.deepEqual(order, []);

    t.mock.timers.tick(1);
    await shutting;
    await nextTurn();
    // destroy() cancels the open one; the one asked after that is refused at once, so a handler
    // that asks until it is answered ends instead of spinning.
    assert.equal(asked, 3);
    assert.deepEqual(order, [
      "session_shutdown",
      "dispose",
      "refused: The session has closed; no dialog can be shown",
    ]);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /did not finish session_start/);
  } finally {
    if (previousValue === undefined) delete process.env.PI_WEB_SHUTDOWN_DEADLINE_MS;
    else process.env.PI_WEB_SHUTDOWN_DEADLINE_MS = previousValue;
  }
});

test("a dialog asked after the wrapper was destroyed is refused at once, not left pending", async (t) => {
  const f = fixture(t, async () => {});
  await f.wrapper.send({ type: "get_state" });
  f.wrapper.destroy();
  const ui = f.wrapper.createExtensionUiContext();
  await assert.rejects(ui.confirm("Late?", ""), /session has closed/);
  await assert.rejects(ui.select("Late?", ["a"]), /session has closed/);
  await assert.rejects(ui.custom(() => ({ render: () => [] })), /session has closed/);
  assert.equal(f.events.some((event) => event.type === "extension_ui_request" && event.title === "Late?"), false);
});
