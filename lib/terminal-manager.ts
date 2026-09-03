import { randomUUID } from "crypto";
import { homedir } from "os";
import { spawn, type IPty } from "node-pty";

export type TerminalEvent =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };

type TerminalListener = (event: TerminalEvent) => void;

interface TerminalRecord {
  pty: IPty;
  listeners: Set<TerminalListener>;
  backlog: string;
  exited: boolean;
  exitCode: number | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __piWebTerminals: Map<string, TerminalRecord> | undefined;
}

const MAX_BACKLOG = 128 * 1024;

function registry(): Map<string, TerminalRecord> {
  if (!globalThis.__piWebTerminals) globalThis.__piWebTerminals = new Map();
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

export function createTerminal(cwd: string, cols: number, rows: number): string {
  const id = randomUUID();
  const shell = process.platform === "win32"
    ? process.env.ComSpec ?? "cmd.exe"
    : process.env.SHELL ?? "/bin/zsh";
  const args = process.platform === "win32" ? [] : ["-l"];
  const pty = spawn(shell, args, {
    name: "xterm-256color",
    cols: Math.max(2, Math.floor(cols) || 80),
    rows: Math.max(2, Math.floor(rows) || 24),
    cwd: cwd || homedir(),
    env: shellEnvironment(),
  });
  const record: TerminalRecord = {
    pty,
    listeners: new Set(),
    backlog: "",
    exited: false,
    exitCode: null,
    cleanupTimer: null,
  };
  registry().set(id, record);

  pty.onData((data) => {
    record.backlog = (record.backlog + data).slice(-MAX_BACKLOG);
    emit(record, { type: "output", data });
  });
  pty.onExit(({ exitCode }) => {
    record.exited = true;
    record.exitCode = exitCode;
    emit(record, { type: "exit", exitCode });
    record.cleanupTimer = setTimeout(() => registry().delete(id), 60_000);
    record.cleanupTimer.unref?.();
  });
  return id;
}

export function hasTerminal(id: string): boolean {
  return registry().has(id);
}

export function subscribeTerminal(
  id: string,
  listener: TerminalListener,
): { backlog: string; exited: boolean; exitCode: number | null; unsubscribe: () => void } | null {
  const record = registry().get(id);
  if (!record) return null;
  record.listeners.add(listener);
  return {
    backlog: record.backlog,
    exited: record.exited,
    exitCode: record.exitCode,
    unsubscribe: () => record.listeners.delete(listener),
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
  record.pty.resize(Math.max(2, Math.floor(cols) || 80), Math.max(2, Math.floor(rows) || 24));
  return true;
}

export function killTerminal(id: string): boolean {
  const record = registry().get(id);
  if (!record) return false;
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  registry().delete(id);
  if (!record.exited) record.pty.kill();
  record.listeners.clear();
  return true;
}
