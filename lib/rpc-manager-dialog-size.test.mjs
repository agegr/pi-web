import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function makeInner(overrides = {}) {
  return {
    sessionId: "dialog-size-test-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {},
    },
    sessionManager: { getCwd: () => process.cwd() },
    settingsManager: { setProjectTrusted: () => {}, getDefaultTools: () => undefined },
    agent: { state: {} },
    extensionRunner: {
      getRegisteredCommands: () => [],
      setUIContext: () => {},
      emit: async () => {},
    },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: () => () => {},
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    getActiveToolNames: () => ["read", "bash", "edit", "write"],
    getAllTools: () => [],
    setActiveToolsByName: () => {},
    pendingMessageCount: 0,
    dispose: () => {},
    reload: async () => {},
    ...overrides,
  };
}

function dialogEvents(events) {
  return events.filter((event) => event.type === "extension_ui_request"
    && ["select", "confirm", "input", "editor"].includes(event.method));
}

test("forwards a valid dialogSize hint onto the dialog request (#947)", () => {
  const events = [];
  const wrapper = new AgentSessionWrapper(makeInner());
  wrapper.onEvent((event) => events.push(event));
  const context = wrapper.createExtensionUiContext();

  context.confirm("Long SQL", "CREATE TABLE ...", { dialogSize: "lg" });
  context.select("Pick", ["a"], { dialogSize: "full" });
  context.input("Name", undefined, { dialogSize: "md" });
  context.editor("Text", undefined, { dialogSize: "sm" });

  const events_ = dialogEvents(events);
  assert.equal(events_.length, 4);
  assert.equal(events_[0].method, "confirm");
  assert.equal(events_[0].dialogSize, "lg");
  assert.equal(events_[1].dialogSize, "full");
  assert.equal(events_[2].dialogSize, "md");
  assert.equal(events_[3].dialogSize, "sm");
});

test("omits the field when no hint is given and drops unknown sizes (#947)", () => {
  const events = [];
  const wrapper = new AgentSessionWrapper(makeInner());
  wrapper.onEvent((event) => events.push(event));
  const context = wrapper.createExtensionUiContext();

  context.confirm("No hint", "msg", { timeout: 1000 });
  context.confirm("Bad hint", "msg", { dialogSize: "huuuuge" });
  context.select("No opts", ["a"]);

  const events_ = dialogEvents(events);
  assert.equal(events_.length, 3);
  for (const event of events_) {
    assert.equal("dialogSize" in event, false);
  }
  // The unrelated timeout option still passes through.
  assert.equal(events_[0].timeout, 1000);
});
