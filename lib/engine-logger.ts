// 统一结构化运行日志（双系统共用：计划编排 + 自主引擎）
// 纯 Node 实现（fs/path/os），不依赖 pi SDK，可在 node --test 中直接 import。
// 设计要点：
//  - 内存环形缓冲（globalThis 跨 HMR 存活）支撑面板快速拉取最近日志；
//  - 文件按 JSONL append 到 <agentDir>/pi-engine.log，限频落盘（debounce，不阻塞主链路）；
//  - 敏感信息（apiKey/鉴权头/密码等）自动脱敏，绝不写入磁盘。

import { appendFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./config-file";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogScope = "orchestrator" | "engine";

export interface LogMeta {
  runId?: string;
  orchestratorId?: string;
  [k: string]: unknown;
}

export interface LogEntry {
  /** ISO 时间戳 */
  at: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
  meta?: LogMeta;
}

const LOG_FILE = "pi-engine.log";
const RING_LIMIT = 1000;
const FLUSH_DEBOUNCE_MS = 120;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEY = /(api[_-]?key|secret|token|auth|password|authorization|cookie|session)/i;

function logFilePath(): string {
  return join(getAgentDir(), LOG_FILE);
}

// 跨 HMR 存活的全局状态。
declare global {
  var __piEngineLogRing: LogEntry[] | undefined;
  var __piEngineLogFileBuffer: string[] | undefined;
  var __piEngineLogFlushScheduled: boolean | undefined;
  var __piEngineLogLevel: LogLevel | undefined;
  var __piEngineLogHooksRegistered: boolean | undefined;
}

function ring(): LogEntry[] {
  if (!globalThis.__piEngineLogRing) globalThis.__piEngineLogRing = [];
  return globalThis.__piEngineLogRing;
}
function fileBuffer(): string[] {
  if (!globalThis.__piEngineLogFileBuffer) globalThis.__piEngineLogFileBuffer = [];
  return globalThis.__piEngineLogFileBuffer;
}

/** 设置最小记录级别（低于该级别的日志被丢弃，默认 debug 全记录）。 */
export function setLogLevel(level: LogLevel): void {
  globalThis.__piEngineLogLevel = level;
}

function sanitizeValue(v: unknown): unknown {
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "<redacted>";
      } else {
        out[k] = sanitizeValue(val);
      }
    }
    return out;
  }
  if (typeof v === "string" && v.length > 2000) {
    return `${v.slice(0, 2000)}…[truncated]`;
  }
  return v;
}

function sanitizeMeta(meta?: LogMeta): LogMeta | undefined {
  if (!meta) return undefined;
  return sanitizeValue(meta) as LogMeta;
}

function scheduleFlush(): void {
  if (globalThis.__piEngineLogFlushScheduled) return;
  globalThis.__piEngineLogFlushScheduled = true;
  const t = setTimeout(() => {
    globalThis.__piEngineLogFlushScheduled = false;
    flushLogs();
  }, FLUSH_DEBOUNCE_MS);
  // 限频落盘不应阻止进程退出。
  if (typeof t.unref === "function") t.unref();
}

/** 立即将缓冲日志写入文件（进程退出钩子调用，best-effort）。 */
export function flushLogs(): void {
  const buf = fileBuffer();
  if (buf.length === 0) return;
  const chunk = buf.join("");
  buf.length = 0;
  try {
    appendFileSync(logFilePath(), chunk, "utf8");
  } catch {
    // 写盘失败不阻断主流程（best-effort）。
  }
}

/**
 * 记录一条结构化日志。
 * @param level 级别（debug/info/warn/error）
 * @param scope 来源（orchestrator 计划编排 / engine 自主引擎）
 * @param message 日志内容（调用方需自行避免在其中写入密钥）
 * @param meta 附带结构化字段（runId/orchestratorId 等；敏感键自动脱敏）
 */
export function log(level: LogLevel, scope: LogScope, message: string, meta?: LogMeta): void {
  const min = globalThis.__piEngineLogLevel ?? "debug";
  if (LEVEL_ORDER[level] < LEVEL_ORDER[min]) return;

  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    scope,
    message,
    meta: sanitizeMeta(meta),
  };

  // 内存环形缓冲（供面板快速拉取）。
  const r = ring();
  r.push(entry);
  if (r.length > RING_LIMIT) r.splice(0, r.length - RING_LIMIT);

  // 文件缓冲 + 限频落盘。
  fileBuffer().push(JSON.stringify(entry) + "\n");
  scheduleFlush();
}

// 便捷方法。
export const logDebug = (scope: LogScope, message: string, meta?: LogMeta) =>
  log("debug", scope, message, meta);
export const logInfo = (scope: LogScope, message: string, meta?: LogMeta) =>
  log("info", scope, message, meta);
export const logWarn = (scope: LogScope, message: string, meta?: LogMeta) =>
  log("warn", scope, message, meta);
export const logError = (scope: LogScope, message: string, meta?: LogMeta) =>
  log("error", scope, message, meta);

/** 返回最近 limit 条日志（内存环形缓冲，进程内）。 */
export function getRecentLogs(limit = 200): LogEntry[] {
  const r = ring();
  return r.slice(Math.max(0, r.length - limit));
}

/**
 * 从磁盘日志文件读取末尾 limit 条（跨重启可追踪历史）。
 * 解析失败的脏行将被跳过，保证返回合法 JSONL 条目。
 */
export function readLogFileTail(limit = 500): LogEntry[] {
  const file = logFilePath();
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // 跳过损坏行。
      }
    }
    return entries.slice(Math.max(0, entries.length - limit));
  } catch {
    return [];
  }
}

// 进程退出前尽量落盘（Next.js 服务端）。用全局标志去重，避免 HMR 累积监听。
// 注意：只注册 beforeExit，不注册 SIGTERM —— 后者会干扰 node --test 的信号处理导致进程无法退出。
if (
  typeof process !== "undefined" &&
  typeof process.on === "function" &&
  !globalThis.__piEngineLogHooksRegistered
) {
  globalThis.__piEngineLogHooksRegistered = true;
  process.once("beforeExit", () => flushLogs());
}
