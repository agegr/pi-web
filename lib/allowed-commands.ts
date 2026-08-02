// allowed-commands.ts —— 受控命令执行白名单（M4 / Q1 / Q2 修复核心）
//
// 统一封装「可执行文件解析 + 参数安全校验」，供 comet-cli 与 runtime/process-runner 共用，
// 杜绝 shell:true 与未白名单的任意命令执行。所有子进程一律以 argv 数组形式经 spawn 启动，
// 绝不拼接 shell 字符串。
import { existsSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";

/** 默认受信可执行白名单（basename，小写）。覆盖构建/测试/版本控制/脚本运行时。 */
const DEFAULT_ALLOWED = new Set<string>([
  "node",
  "node.exe",
  "npm",
  "npm.cmd",
  "npx",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
  "git",
  "git.exe",
  "python",
  "python3",
  "python.exe",
  "pip",
  "go",
  "go.exe",
  "make",
  "make.exe",
  "tsc",
  "cargo",
  "cargo.exe",
  "bun",
  "bun.exe",
  "deno",
  "deno.exe",
  "sh",
  "bash",
  "comet",
  "comet-state.mjs",
  "comet-guard.mjs",
  "comet-archive.mjs",
  "comet-handoff.mjs",
  "comet-yaml-validate.mjs",
  "comet-env.mjs",
]);

/** 从 ENGINE_ALLOWED_COMMANDS（逗号分隔）读取的额外白名单。 */
function extraAllowed(): Set<string> {
  const raw = process.env.ENGINE_ALLOWED_COMMANDS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

let allowedCache: Set<string> | null = null;
function allowedSet(): Set<string> {
  if (!allowedCache) allowedCache = new Set([...DEFAULT_ALLOWED, ...extraAllowed()]);
  return allowedCache;
}

/** 清空白名单缓存（测试用）。 */
export function resetAllowedCache(): void {
  allowedCache = null;
}

const SHELL_META = /[;&|`$()<>\\#!{}*?~]/;
const MAX_ARG_LEN = 8192;

/** 检测字符串是否含控制字符（除常见空白 TAB/LF/CR 外），用于注入防御。 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isCommonWhitespace = c === 0x09 || c === 0x0a || c === 0x0d;
    if ((c < 0x20 && !isCommonWhitespace) || c === 0x7f) return true;
  }
  return false;
}

/** 校验单个命令行参数：拒绝空字节、控制字符、超长、空格（shell 风格分词）与危险 shell 元字符。 */
export function isSafeArg(arg: string): boolean {
  if (typeof arg !== "string") return false;
  if (arg.length > MAX_ARG_LEN) return false;
  if (arg.indexOf(String.fromCharCode(0)) !== -1) return false; // 空字节
  if (arg.includes(" ")) return false; // 空格表明 shell 风格分词，违反 argv 纪律
  if (hasControlChar(arg)) return false;
  if (SHELL_META.test(arg)) return false;
  return true;
}

/** 校验整组参数。 */
export function assertSafeArgs(args: readonly string[]): void {
  for (const a of args) {
    if (!isSafeArg(a)) {
      throw new Error("非法命令参数（疑似注入）：" + JSON.stringify(a).slice(0, 200));
    }
  }
}

/** 判断二进制是否受白名单允许（按 basename 小写比对）。 */
export function isCommandAllowed(binary: string): boolean {
  const base = binary.toLowerCase();
  return allowedSet().has(base) || allowedSet().has(base.split(sep).pop() ?? base);
}

/**
 * 受信的「Agent 命令类型」白名单（仅用于 HTTP 路由分发校验）。
 *
 * `POST /api/agent/[id]` 与 `POST /api/agent/new` 在把入站指令 `type` 派发给
 * `AgentSession.send` 前，先按此集合校验，避免客户端（或 CSRF）调用任意包装方法。
 *
 * 注意：`ensure_session` 故意不在内——它是 `/new` 路由自身处理的内部伪命令
 * （不会调用 `session.send`），故不能通过该共享派发闸门。
 *
 * 与下方的「可执行文件白名单」(resolveExecutable/isCommandAllowed) 是两个不同维度：
 * 此处是 pi 包装命令的类型名，下方是引擎子进程实际启动的二进制 basename。
 */
export const ALLOWED_AGENT_COMMANDS: ReadonlySet<string> = new Set([
  "prompt",
  "abort",
  "get_state",
  "fork",
  "navigate_tree",
  "compact",
  "set_model",
  "set_thinking_level",
  "set_session_name",
  "set_session_parent",
  "get_session_stats",
  "get_last_assistant_text",
  "set_auto_compaction",
  "clear_queue",
  "steer",
  "follow_up",
  "get_tools",
  "get_commands",
  "set_tools",
  "reload",
  "abort_compaction",
  "extension_ui_response",
  "extension_ui_input",
  "set_auto_retry",
]);

/** True when `type` 是可派发的 agent 命令类型。 */
export function isAllowedAgentCommand(type: string): boolean {
  return ALLOWED_AGENT_COMMANDS.has(type);
}

/** 解析可执行文件绝对路径：经 PATH 查找，或接受已存在的绝对路径（须在白名单内）。 */
export function resolveExecutable(binary: string, cwd?: string): string {
  if (!binary || hasControlChar(binary)) {
    throw new Error("非法可执行名：" + JSON.stringify(binary).slice(0, 200));
  }
  if (binary.includes("/") || binary.includes("\\") || isAbsolute(binary)) {
    const abs = isAbsolute(binary) ? resolve(binary) : resolve(cwd ?? process.cwd(), binary);
    if (!existsSync(abs)) throw new Error("可执行文件不存在：" + abs);
    if (!isCommandAllowed(abs)) throw new Error("可执行文件不在白名单：" + abs);
    return abs;
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  if (cwd && existsSync(resolve(cwd, binary))) {
    const abs = resolve(cwd, binary);
    if (!isCommandAllowed(abs)) throw new Error("可执行文件不在白名单：" + abs);
    return abs;
  }
  for (const dir of dirs) {
    const cand = resolve(dir, binary);
    if (existsSync(cand)) {
      if (!isCommandAllowed(cand)) throw new Error("可执行文件不在白名单：" + cand);
      return cand;
    }
  }
  throw new Error("可执行文件未在 PATH 中找到：" + binary);
}
