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
    sessionId: "widget-test-session",
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

function createContext(overrides = {}) {
  const events = [];
  const wrapper = new AgentSessionWrapper(makeInner(overrides));
  wrapper.onEvent((event) => events.push(event));
  const context = wrapper.createExtensionUiContext();
  return { context, events, wrapper };
}

function widgetEvents(events) {
  return events.filter((event) => event.type === "extension_ui_request" && event.method === "setWidget");
}

function snapshot(wrapper) {
  return wrapper.send({ type: "get_state" }).then((state) => state.extensionWidgets);
}

test("keeps array widgets compatible while maintaining the state snapshot", async () => {
  const { context, events, wrapper } = createContext();

  context.setWidget("array", ["one"], { placement: "belowEditor" });
  assert.deepEqual(widgetEvents(events).at(-1), {
    type: "extension_ui_request",
    id: widgetEvents(events).at(-1).id,
    method: "setWidget",
    widgetKey: "array",
    widgetLines: ["one"],
    widgetPlacement: "belowEditor",
  });
  assert.deepEqual(await snapshot(wrapper), [{ key: "array", lines: ["one"], placement: "belowEditor" }]);

  const eventCount = widgetEvents(events).length;
  context.setWidget("array", ["two"]);
  assert.equal(widgetEvents(events).length, eventCount + 1);
  assert.equal(widgetEvents(events).at(-1).widgetLines[0], "two");
  assert.equal(widgetEvents(events).at(-1).widgetPlacement, undefined);
  assert.deepEqual(await snapshot(wrapper), [{ key: "array", lines: ["two"], placement: "aboveEditor" }]);
  wrapper.destroy();
});

test("renders a factory widget immediately with the fixed headless facade", async () => {
  const { context, events, wrapper } = createContext();
  let tui;
  let theme;
  const widths = [];

  context.setWidget("factory", (receivedTui, receivedTheme) => {
    tui = receivedTui;
    theme = receivedTheme;
    return {
      render(width) {
        widths.push(width);
        return [`${width}:${tui.terminal.columns}`];
      },
    };
  }, { placement: "belowEditor" });

  const event = widgetEvents(events).at(-1);
  assert.equal(tui.terminal.columns, 92);
  assert.equal(tui.terminal.kittyProtocolActive, false);
  assert.ok(theme);
  assert.deepEqual(widths, [92]);
  assert.deepEqual(event.widgetLines, ["92:92"]);
  assert.equal(event.widgetPlacement, "belowEditor");
  assert.deepEqual(await snapshot(wrapper), [{ key: "factory", lines: ["92:92"], placement: "belowEditor" }]);
  wrapper.destroy();
});

test("requestRender replaces the browser event and server snapshot", async () => {
  const { context, events, wrapper } = createContext();
  let tui;
  let value = "first";
  context.setWidget("refreshable", (receivedTui) => {
    tui = receivedTui;
    return { render: () => [value] };
  });

  const before = widgetEvents(events).length;
  value = "second";
  tui.requestRender();
  assert.equal(widgetEvents(events).length, before + 1);
  assert.deepEqual(widgetEvents(events).at(-1).widgetLines, ["second"]);
  assert.deepEqual(await snapshot(wrapper), [{ key: "refreshable", lines: ["second"], placement: "aboveEditor" }]);
  wrapper.destroy();
});

test("clearing and replacing widgets disposes components and invalidates old callbacks", () => {
  const { context, events, wrapper } = createContext();
  let oldTui;
  let oldDisposed = 0;
  context.setWidget("shared", (tui) => {
    oldTui = tui;
    return { render: () => ["old"], dispose: () => { oldDisposed += 1; } };
  });
  const beforeReplace = widgetEvents(events).length;

  context.setWidget("shared", ["array"]);
  assert.equal(oldDisposed, 1);
  assert.deepEqual(widgetEvents(events).at(-1).widgetLines, ["array"]);
  const afterReplace = widgetEvents(events).length;
  oldTui.requestRender();
  assert.equal(widgetEvents(events).length, afterReplace);

  let newTui;
  let newDisposed = 0;
  context.setWidget("shared", (tui) => {
    newTui = tui;
    return { render: () => ["new"], dispose: () => { newDisposed += 1; } };
  });
  const afterFactoryReplace = widgetEvents(events).length;
  oldTui.requestRender();
  assert.equal(widgetEvents(events).length, afterFactoryReplace);

  context.setWidget("shared", undefined);
  assert.equal(newDisposed, 1);
  const afterClear = widgetEvents(events).length;
  newTui.requestRender();
  assert.equal(widgetEvents(events).length, afterClear);
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.ok(beforeReplace < afterReplace);
  wrapper.destroy();
});

test("isolates factory and render failures with a clear and extension_error", async () => {
  const { context, events, wrapper } = createContext();
  context.setWidget("factory-error", () => {
    throw new Error("factory failed");
  });
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.equal(events.at(-1).type, "extension_error");
  assert.match(events.at(-1).error, /factory failed/);
  assert.deepEqual(await snapshot(wrapper), []);

  context.setWidget("factory-error", () => ({ render: () => ["recovered"] }));
  assert.deepEqual(await snapshot(wrapper), [{ key: "factory-error", lines: ["recovered"], placement: "aboveEditor" }]);
  context.setWidget("factory-error", undefined);

  context.setWidget("invalid-component", () => ({
    dispose: () => { throw new Error("dispose failed"); },
  }));
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.match(events.at(-1).error, /render\(width\)/);
  assert.deepEqual(await snapshot(wrapper), []);

  let disposed = 0;
  context.setWidget("render-error", () => ({
    render: () => { throw new Error("render failed"); },
    dispose: () => { disposed += 1; },
  }));
  assert.equal(disposed, 1);
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.match(events.at(-1).error, /render failed/);
  assert.deepEqual(await snapshot(wrapper), []);

  context.setWidget("invalid-lines", () => ({ render: () => ["ok", 7] }));
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.match(events.at(-1).error, /string\[\]/);
  assert.deepEqual(await snapshot(wrapper), []);

  let tui;
  let shouldThrow = false;
  context.setWidget("late-render", (receivedTui) => {
    tui = receivedTui;
    return {
      render: () => {
        if (shouldThrow) throw new Error("late render failed");
        return ["live"];
      },
    };
  });
  shouldThrow = true;
  tui.requestRender();
  assert.equal(widgetEvents(events).at(-1).widgetLines, undefined);
  assert.match(events.at(-1).error, /late render failed/);
  assert.deepEqual(await snapshot(wrapper), []);
  wrapper.destroy();
});

test("reload and destroy dispose factory components and invalidate callbacks", async () => {
  const reloads = [];
  const { context, events, wrapper } = createContext({
    reload: async (options) => {
      reloads.push(options);
    },
  });
  let tui;
  let disposed = 0;
  context.setWidget("lifecycle", (receivedTui) => {
    tui = receivedTui;
    return { render: () => ["live"], dispose: () => { disposed += 1; } };
  });

  await wrapper.send({ type: "reload" });
  assert.equal(disposed, 1);
  assert.equal(reloads.length, 1);
  assert.deepEqual(await snapshot(wrapper), []);
  const afterReload = widgetEvents(events).length;
  tui.requestRender();
  assert.equal(widgetEvents(events).length, afterReload);

  let replacementTui;
  context.setWidget("lifecycle", (receivedTui) => {
    replacementTui = receivedTui;
    return { render: () => ["replacement"], dispose: () => { disposed += 1; } };
  });
  wrapper.destroy();
  assert.equal(disposed, 2);
  const afterDestroy = widgetEvents(events).length;
  replacementTui.requestRender();
  assert.equal(widgetEvents(events).length, afterDestroy);
});

test("command-context reload also clears factory widgets", async () => {
  const { context, wrapper } = createContext();
  let disposed = 0;
  context.setWidget("command-reload", () => ({
    render: () => ["live"],
    dispose: () => { disposed += 1; },
  }));

  await wrapper.createExtensionCommandContextActions().reload();
  assert.equal(disposed, 1);
  assert.deepEqual(await snapshot(wrapper), []);
  wrapper.destroy();
});

test("dispose-time reentrant updates remain authoritative", async () => {
  const { context, events, wrapper } = createContext();
  let replacementTui;

  context.setWidget("reentrant", () => ({
    render: () => ["old"],
    dispose: () => {
      context.setWidget("reentrant", (tui) => {
        replacementTui = tui;
        return { render: () => ["replacement"] };
      });
    },
  }));

  context.setWidget("reentrant", ["outer"]);
  assert.deepEqual(await snapshot(wrapper), [{
    key: "reentrant",
    lines: ["replacement"],
    placement: "aboveEditor",
  }]);

  const beforeRefresh = widgetEvents(events).length;
  replacementTui.requestRender();
  assert.equal(widgetEvents(events).length, beforeRefresh + 1);
  assert.deepEqual(widgetEvents(events).at(-1).widgetLines, ["replacement"]);
  context.setWidget("reentrant", undefined);
  wrapper.destroy();
});

test("render failure does not clear a dispose-time recovery widget", async () => {
  const { context, wrapper } = createContext();

  context.setWidget("render-recovery", () => ({
    render: () => { throw new Error("render failed"); },
    dispose: () => context.setWidget("render-recovery", ["recovered"]),
  }));

  assert.deepEqual(await snapshot(wrapper), [{
    key: "render-recovery",
    lines: ["recovered"],
    placement: "aboveEditor",
  }]);
  wrapper.destroy();
});

test("ignores factory registrations after the wrapper is destroyed", () => {
  const { context, events, wrapper } = createContext();
  let factoryCalls = 0;

  wrapper.destroy();
  const before = events.length;
  context.setWidget("late", () => {
    factoryCalls += 1;
    return { render: () => ["late"] };
  });

  assert.equal(factoryCalls, 0);
  assert.equal(events.length, before);
});

test("reload ignores widget registrations triggered by component disposal", async () => {
  const { context, wrapper } = createContext();

  context.setWidget("reload-source", () => ({
    render: () => ["live"],
    dispose: () => context.setWidget("reload-stale", () => ({ render: () => ["stale"] })),
  }));

  await wrapper.send({ type: "reload" });
  assert.deepEqual(await snapshot(wrapper), []);
  wrapper.destroy();
});
