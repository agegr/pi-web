import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(t) {
  const inner = {
    sessionId: "extension-timeout-test",
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, dispose() {},
    clearQueue: () => ({ steering: [], followUp: [] }),
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, ui: wrapper.createExtensionUiContext(), events };
}

// pi's TUI (CountdownTimer in interactive mode, `opts.timeout > 0`) counts a dialog down in whole
// seconds, so a timeout that is not a positive number never expires and a huge one (Infinity,
// Number.MAX_SAFE_INTEGER, 30 days) waits for the person. A setTimeout of more than 2^31 - 1 ms
// fires after 1 ms instead, which answered the dialog with its default (confirm: false) at once.
for (const timeout of [Infinity, Number.MAX_SAFE_INTEGER, 30 * 24 * 60 * 60 * 1000, -1]) {
  test(`a dialog with timeout ${timeout} stays open as in pi's TUI`, async (t) => {
    const { wrapper, ui, events } = setup(t);
    let answer;
    ui.confirm("Run it?", "rm -rf", { timeout }).then((value) => { answer = value; });
    await wait(60);
    assert.equal(answer, undefined, "the dialog was answered by its default without a person");
    const request = events.find((event) => event.method === "confirm");
    assert.ok(request);
    wrapper.resolveExtensionUiResponse({ type: "extension_ui_response", id: request.id, confirmed: true });
    await wait(5);
    assert.equal(answer, true);
  });
}

test("a short timeout still answers with the default", async (t) => {
  const { ui } = setup(t);
  assert.equal(await ui.confirm("Run it?", "x", { timeout: 20 }), false);
});
