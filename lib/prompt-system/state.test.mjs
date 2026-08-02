import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 让状态模块落盘到临时目录，避免污染真实 agent-dir。必须在 import 前设置。
const TMP = mkdtempSync(join(tmpdir(), "pi-prompt-state-"));
process.env.PI_CODING_AGENT_DIR = TMP;

const { estimateTokens, formatTokenCount } = await import("./tokenize.ts");
const { registerModules, getModules, getModule, clearRegistry } = await import("./registry.ts");
const {
  getModuleEnabled,
  setModuleEnabled,
  getCompressedOverride,
  setCompressedOverride,
  getAgentsMdModular,
  setAgentsMdModular,
  _resetPromptModulesCache,
} = await import("../prompt-modules-state.ts");

test("estimateTokens is deterministic and roughly chars/4", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("a".repeat(40)), 10);
  assert.equal(estimateTokens("hello"), estimateTokens("hello"));
});

test("formatTokenCount formats k/M", () => {
  assert.equal(formatTokenCount(950), "950");
  assert.equal(formatTokenCount(1500), "2k");
  assert.equal(formatTokenCount(2_500_000), "2.5M");
});

test("registry registers, filters by source, and overrides by id", () => {
  clearRegistry();
  registerModules([
    { id: "a.1", source: "app", category: "identity", tags: ["x"], text: "A1" },
    { id: "m.1", source: "agents-md", category: "other", tags: ["y"], text: "M1" },
  ]);
  assert.equal(getModules().length, 2);
  assert.equal(getModules("app").length, 1);
  assert.equal(getModule("m.1")?.text, "M1");

  // 同 id 覆盖
  registerModules([{ id: "a.1", source: "app", category: "tone", tags: ["z"], text: "A1b" }]);
  assert.equal(getModules().length, 2);
  assert.equal(getModule("a.1")?.text, "A1b");
});

test("module state defaults enabled and persists across reads", () => {
  _resetPromptModulesCache();
  assert.equal(getModuleEnabled("mod.x"), true, "default enabled");
  setModuleEnabled("mod.x", false);
  assert.equal(getModuleEnabled("mod.x"), false);
  // 重新读取内存缓存应一致
  assert.equal(getModuleEnabled("mod.x"), false);
});

test("module state persists to disk and reloads", () => {
  _resetPromptModulesCache();
  setModuleEnabled("mod.y", false);
  // 模拟进程重载：清空缓存，从磁盘读取
  _resetPromptModulesCache();
  assert.equal(getModuleEnabled("mod.y", true), false);
});

test("compressed override set / clear", () => {
  _resetPromptModulesCache();
  assert.equal(getCompressedOverride("mod.z"), undefined);
  setCompressedOverride("mod.z", "压缩版");
  assert.equal(getCompressedOverride("mod.z"), "压缩版");
  setCompressedOverride("mod.z", undefined);
  assert.equal(getCompressedOverride("mod.z"), undefined);
});

test("agents-md modular master switch toggles and persists", () => {
  _resetPromptModulesCache();
  assert.equal(getAgentsMdModular(), false);
  setAgentsMdModular(true);
  _resetPromptModulesCache();
  assert.equal(getAgentsMdModular(), true);
  setAgentsMdModular(false);
});

test.after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
