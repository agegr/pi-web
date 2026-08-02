// 提示词模块开关状态持久化层（照搬 lib/plugin-master-switch.ts 范式）。
//
// 落盘到 agent-dir 的侧车 JSON `pi-web-prompt-modules.json`，不依赖任何 SDK。
// 真正的「启用/禁用」「压缩覆盖」「AGENTS.md modular 总闸」动作由调用方
// （switches.ts / rpc-manager / API 路由）根据这里读到的状态执行。
//
// 设计要点：
// - 默认 enabled = true，保证升级/新装用户行为与现状一致（模块全量发送）。
// - agentsMdModular 默认 false，coding-agent 系统提示词默认走 SDK 原样注入，
//   开启后才按模块动态裁剪。
// - 状态同时缓存在 globalThis，跨热重载存活，避免每次都读盘。
// - 本模块刻意 @/-free（内联 getAgentDir），以便纯 node:test 单测直接 import。

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_FILE = "pi-web-prompt-modules.json";

/** 单个模块的运行态：开关 + 压缩覆盖文本。 */
export interface PromptModuleState {
  /** 是否启用（默认 true）。 */
  enabled: boolean;
  /** 用户压缩/LLM 精炼后的覆盖文本；缺省时回退到模块原文或 compressedText。 */
  compressedOverride?: string;
}

/** 全局提示词模块状态。 */
export interface PromptModulesState {
  /** 每模块开关与压缩覆盖，键为模块 id。 */
  modules: Record<string, PromptModuleState>;
  /** AGENTS.md modular 总闸：true 时对 coding-agent 系统提示词按模块动态裁剪。 */
  agentsMdModular: boolean;
}

declare global {
  var __piPromptModulesState: PromptModulesState | undefined;
}

// 与 lib/config-file.getAgentDir 完全一致，内联以避免 @/ 依赖（保持可单测）。
function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function defaultState(): PromptModulesState {
  return { modules: {}, agentsMdModular: false };
}

function statePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

export function readPromptModulesState(): PromptModulesState {
  if (globalThis.__piPromptModulesState) return globalThis.__piPromptModulesState;
  try {
    if (!existsSync(statePath())) {
      globalThis.__piPromptModulesState = defaultState();
      return globalThis.__piPromptModulesState;
    }
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<PromptModulesState>;
    const state: PromptModulesState = {
      modules: parsed.modules && typeof parsed.modules === "object" ? parsed.modules : {},
      agentsMdModular: typeof parsed.agentsMdModular === "boolean" ? parsed.agentsMdModular : false,
    };
    globalThis.__piPromptModulesState = state;
    return state;
  } catch {
    globalThis.__piPromptModulesState = defaultState();
    return globalThis.__piPromptModulesState;
  }
}

export function writePromptModulesState(state: PromptModulesState): void {
  globalThis.__piPromptModulesState = state;
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${statePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, statePath());
}

/** 模块是否启用；无记录时返回 dflt（默认 true）。 */
export function getModuleEnabled(id: string, dflt = true): boolean {
  const s = readPromptModulesState().modules[id];
  return s ? s.enabled : dflt;
}

/** 设置模块启用/禁用。 */
export function setModuleEnabled(id: string, enabled: boolean): void {
  const state = readPromptModulesState();
  const prev = state.modules[id] ?? {};
  state.modules[id] = { ...prev, enabled };
  writePromptModulesState(state);
}

/** 读取模块的压缩覆盖文本（无则返回 undefined）。 */
export function getCompressedOverride(id: string): string | undefined {
  return readPromptModulesState().modules[id]?.compressedOverride;
}

/** 写入/清除模块的压缩覆盖文本（undefined 表示清除覆盖，回退原文/compressedText）。 */
export function setCompressedOverride(id: string, text: string | undefined): void {
  const state = readPromptModulesState();
  const prev = state.modules[id] ?? {};
  if (text === undefined) {
    const { compressedOverride: _drop, ...rest } = prev;
    state.modules[id] = rest;
  } else {
    state.modules[id] = { ...prev, compressedOverride: text };
  }
  writePromptModulesState(state);
}

/** AGENTS.md modular 总闸是否开启。 */
export function getAgentsMdModular(): boolean {
  return readPromptModulesState().agentsMdModular;
}

/** 设置 AGENTS.md modular 总闸。 */
export function setAgentsMdModular(on: boolean): void {
  const state = readPromptModulesState();
  state.agentsMdModular = on;
  writePromptModulesState(state);
}

/** 测试辅助：清空内存缓存（不删文件）。 */
export function _resetPromptModulesCache(): void {
  globalThis.__piPromptModulesState = undefined;
}
