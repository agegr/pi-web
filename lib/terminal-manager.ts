import { randomUUID } from "crypto";
import { homedir } from "os";
import { spawn, type IPty } from "node-pty";
import { samePath } from "./paths";

export type TerminalEvent =
  | { type: "output"; data: string; offset: number; reset?: boolean }
  | { type: "exit"; exitCode: number }
  | { type: "closed" };

type TerminalListener = (event: TerminalEvent) => void;

interface TerminalRecord {
  pty: IPty;
  cwd: string;
  listeners: Set<TerminalListener>;
  backlog: string;
  offset: number;
  exited: boolean;
  exitCode: number | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __piWebTerminals: Map<string, TerminalRecord> | undefined;
}

// ponytail: bounded replay; use terminal serialization if full-screen snapshots become necessary.
const MAX_BACKLOG = 128 * 1024;
export const TERMINAL_RECONNECT_MS = 120_000;

function registry(): Map<string, TerminalRecord> {
  if (!globalThis.__piWebTerminals) {
    globalThis.__piWebTerminals = new Map();
    const shutdown = () => {
      for (const id of globalThis.__piWebTerminals!.keys()) killTerminal(id, true);
    };
    process.once("exit", shutdown);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return globalThis.__piWebTerminals;
}

function shellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

function emit(record: TerminalRecord, event: TerminalEvent): void {
  for (const listener of record.listeners) listener(event);
}

function scheduleCleanup(id: string, record: TerminalRecord): void {
  if (record.cleanupTimer || record.listeners.size || registry().get(id) !== record) return;
  record.cleanupTimer = setTimeout(() => killTerminal(id), TERMINAL_RECONNECT_MS);
  record.cleanupTimer.unref?.();
}

function dimension(value: number, fallback: number): number {
  return Math.min(1000, Math.max(2, Number.isFinite(value) ? Math.floor(value) : fallback));
}

export function createTerminal(cwd: string, cols: number, rows: number, id: string = randomUUID()): string {
  const existing = registry().get(id);
  if (existing) {
    if (!samePath(existing.cwd, cwd)) throw new Error("Terminal belongs to a different workspace");
    return id;
  }
  const shell = process.platform === "win32"
    ? process.env.ComSpec ?? "cmd.exe"
    : process.env.SHELL || "/bin/sh";
  const args = process.platform === "win32" ? [] : ["-l"];
  const pty = spawn(shell, args, {
    name: "xterm-256color",
    cols: dimension(cols, 80),
    rows: dimension(rows, 24),
    cwd: cwd || homedir(),
    env: shellEnvironment(),
  });
  const record: TerminalRecord = {
    pty,
    cwd,
    listeners: new Set(),
    backlog: "",
    offset: 0,
    exited: false,
    exitCode: null,
    cleanupTimer: null,
  };
  registry().set(id, record);
  // Includes creations whose response or initial SSE connection never arrives.
  scheduleCleanup(id, record);

  pty.onData((data) => {
    record.backlog = (record.backlog + data).slice(-MAX_BACKLOG);
    record.offset += data.length;
    emit(record, { type: "output", data, offset: record.offset });
  });
  pty.onExit(({ exitCode }) => {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
    record.cleanupTimer = null;
    record.exited = true;
    record.exitCode = exitCode;
    emit(record, { type: "exit", exitCode });
    scheduleCleanup(id, record);
  });
  return id;
}

export function hasTerminal(id: string): boolean {
  return registry().has(id);
}

export function getTerminalCwd(id: string): string | undefined {
  return registry().get(id)?.cwd;
}

export function subscribeTerminal(
  id: string,
  listener: TerminalListener,
  after?: number,
): { output: Extract<TerminalEvent, { type: "output" }>; exited: boolean; exitCode: number | null; unsubscribe: () => void } | null {
  const record = registry().get(id);
  if (!record) return null;
  record.listeners.add(listener);
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  record.cleanupTimer = null;
  const start = record.offset - record.backlog.length;
  const reset = after === undefined || after < start || after > record.offset;
  return {
    output: {
      type: "output",
      data: reset ? record.backlog : record.backlog.slice(after - start),
      offset: record.offset,
      reset,
    },
    exited: record.exited,
    exitCode: record.exitCode,
    unsubscribe: () => {
      record.listeners.delete(listener);
      scheduleCleanup(id, record);
    },
  };
}

export function writeTerminal(id: string, data: string): boolean {
  const record = registry().get(id);
  if (!record || record.exited) return false;
  record.pty.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const record = registry().get(id);
  if (!record || record.exited) return false;
  record.pty.resize(dimension(cols, 80), dimension(rows, 24));
  return true;
}

export function killTerminal(id: string, force = false): boolean {
  const record = registry().get(id);
  if (!record) return false;
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  registry().delete(id);
  if (!record.exited) {
    record.pty.kill(force ? "SIGKILL" : undefined);
    // A shell may trap SIGHUP; explicit close and lease expiry must still finish.
    if (!force) {
      record.cleanupTimer = setTimeout(() => {
        if (!record.exited) record.pty.kill("SIGKILL");
      }, 2000);
      record.cleanupTimer.unref?.();
    }
  }
  emit(record, { type: "closed" });
  record.listeners.clear();
  return true;
}
