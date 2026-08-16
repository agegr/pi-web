import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  classifyRouterMode,
  createReasoningRouterExtension,
  parseRouterSetting,
  personaForRouterMode,
  readRouterState,
} = await jiti.import("./reasoning-router.ts");

function custom(customType, mode) {
  return { type: "custom", customType, data: { mode } };
}

function createHarness(entries = [], activeTools = ["read", "bash", "edit", "write"]) {
  const commands = new Map();
  const handlers = new Map();
  const appended = [];
  const notifications = [];
  const statuses = new Map();
  const pi = {
    registerCommand(name, command) {
      commands.set(name, command);
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    appendEntry(customType, data) {
      const entry = { type: "custom", customType, data };
      appended.push(entry);
      entries.push(entry);
    },
    getActiveTools() {
      return activeTools;
    },
  };
  const ctx = {
    model: { id: "deepseek-v4-flash" },
    sessionManager: { getBranch: () => entries },
    ui: {
      notify: (message, type) => notifications.push({ message, type }),
      setStatus: (key, text) => {
        if (text === undefined) statuses.delete(key);
        else statuses.set(key, text);
      },
    },
  };
  const extension = createReasoningRouterExtension();
  extension.factory(pi);
  return { appended, commands, ctx, handlers, notifications, statuses };
}

test("classifies build, fix, and ambiguous prompts into stable modes", () => {
  assert.equal(classifyRouterMode("创建一个新的网页应用"), "react");
  assert.equal(classifyRouterMode("修复崩溃并排查根因"), "spec");
  assert.equal(classifyRouterMode("当前实现有 bug，请修复并运行测试"), "spec");
  assert.equal(classifyRouterMode("帮我看看这个需求"), "weak");
  assert.equal(classifyRouterMode("请只回复结果，不要调用工具"), "weak");
});

test("parses only supported router settings", () => {
  assert.equal(parseRouterSetting(" on "), "auto");
  assert.equal(parseRouterSetting("SPEC"), "spec");
  assert.equal(parseRouterSetting("balanced"), null);
});

test("reconstructs the latest persisted setting and auto resolution", () => {
  const entries = [
    custom("pi-web-router-setting", "auto"),
    custom("pi-web-router-resolved", "react"),
    custom("pi-web-router-setting", "spec"),
  ];
  assert.deepEqual(readRouterState(entries), { setting: "spec", resolved: undefined });
});

test("defaults off and leaves the system prompt untouched", () => {
  const harness = createHarness();
  const result = harness.handlers.get("before_agent_start")(
    { prompt: "build an app", systemPrompt: "base" },
    harness.ctx,
  );
  assert.equal(result, undefined);
  assert.equal(harness.appended.length, 0);
});

test("router yields to the existing no-tools system prompt contract", async () => {
  const entries = [custom("pi-web-router-setting", "react")];
  const harness = createHarness(entries, []);
  const result = harness.handlers.get("before_agent_start")(
    { prompt: "创建一个应用", systemPrompt: "" },
    harness.ctx,
  );
  assert.equal(result, undefined);
});

test("auto routing persists its first decision and injects weak guidance", async () => {
  const entries = [];
  const harness = createHarness(entries);
  await harness.commands.get("router").handler("auto", harness.ctx);

  const hook = harness.handlers.get("before_agent_start");
  const first = hook(
    { prompt: "Please help me with this task", systemPrompt: "base" },
    harness.ctx,
  );
  assert.match(first.systemPrompt, /pi_web_router mode="weak"/);
  assert.equal(first.message.customType, "pi-web-router-guide");
  assert.equal(first.message.display, false);
  assert.equal(harness.statuses.get("router"), "Router: auto -> weak");
  assert.deepEqual(readRouterState(entries), { setting: "auto", resolved: "weak" });

  const second = hook(
    { prompt: "创建一个新应用", systemPrompt: "base" },
    harness.ctx,
  );
  assert.match(second.systemPrompt, /pi_web_router mode="weak"/);
  assert.equal(harness.appended.filter((entry) => entry.customType === "pi-web-router-resolved").length, 1);
});

test("flash models receive the model-specific weak persona", () => {
  assert.match(personaForRouterMode("weak", "deepseek-v4-flash"), /avoid repeated environment checks/);
  assert.doesNotMatch(personaForRouterMode("weak", "claude-sonnet"), /avoid repeated environment checks/);
});
