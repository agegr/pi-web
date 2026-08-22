import * as pty from "node-pty";
import { resolveTerminalShell } from "./terminal-shell";

declare global {
  // Kept on globalThis (not a module Map) so terminal processes survive
  // Next.js hot-reload, mirroring the rpc-manager session registry.
  var __piTerminals: Map<string, TerminalSession> | undefined;
  var __piTerminalShutdownHooked: boolean | undefined;
}

export const DEFAULT_TERMINAL_COLUMNS = 100;
export const DEFAULT_TERMINAL_ROWS = 30;

const registry = (): Map<string, TerminalSession> => {
  if (!globalThis.__piTerminals) {
    globalThis.__piTerminals = new Map();
    installProcessShutdownHook();
  }
  return globalThis.__piTerminals;
};

let sequence = 0;

function installProcessShutdownHook(): void {
  if (globalThis.__piTerminalShutdownHooked) return;
  globalThis.__piTerminalShutdownHooked = true;
  // node-pty's kill() is synchronous native code, so this works on `exit`.
  process.once("exit", () => {
    for (const session of registry().values()) session.kill();
  });
}

export type TerminalDataListener = (data: string) => void;
export type TerminalExitListener = (exitCode: number) => void;

export interface TerminalPublicInfo {
  id: string;
  pid: number;
  cwd: string;
  shellLabel: string;
  createdAt: number;
  isRunning: boolean;
}

/**
 * One interactive shell process managed by node-pty (ConPTY on Windows).
 * Subscribers receive raw output chunks and a single exit notification; write
 * and resize calls proxy straight through to the underlying pty.
 */
export class TerminalSession {
  readonly id: string;
  readonly pid: number;
  readonly cwd: string;
  readonly shellLabel: string;
  readonly createdAt: number;
  private readonly process: pty.IPty;
  private readonly dataListeners = new Set<TerminalDataListener>();
  private readonly exitListeners = new Set<TerminalExitListener>();
  private running = true;

  constructor(
    id: string,
    processHandle: pty.IPty,
    cwd: string,
    shellLabel: string,
  ) {
    this.id = id;
    this.process = processHandle;
    this.pid = processHandle.pid;
    this.cwd = cwd;
    this.shellLabel = shellLabel;
    this.createdAt = Date.now();

    processHandle.onData((data) => {
      for (const listener of this.dataListeners) listener(data);
    });
    const onExited = (exitCode: number) => {
      this.running = false;
      for (const listener of this.exitListeners) listener(exitCode);
      this.dataListeners.clear();
      this.exitListeners.clear();
    };
    processHandle.onExit(({ exitCode }) => {
      onExited(exitCode);
      registry().delete(this.id);
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  toPublicInfo(): TerminalPublicInfo {
    return {
      id: this.id,
      pid: this.pid,
      cwd: this.cwd,
      shellLabel: this.shellLabel,
      createdAt: this.createdAt,
      isRunning: this.running,
    };
  }

  subscribeData(listener: TerminalDataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  subscribeExit(listener: TerminalExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  write(data: string): void {
    if (this.running) this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.running) this.process.resize(cols, rows);
  }

  kill(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.process.kill();
    } catch {
      // The pty may already be gone; the onExit handler finalizes cleanup.
    }
  }
}

export function createTerminalSession(
  cwd: string,
  columns = DEFAULT_TERMINAL_COLUMNS,
  rows = DEFAULT_TERMINAL_ROWS,
): TerminalSession {
  const shell = resolveTerminalShell();
  const id = `t${Date.now().toString(36)}${(sequence++).toString(36)}`;
  const processHandle = pty.spawn(shell.file, shell.args, {
    name: "xterm-256color",
    cols: columns,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  });
  const session = new TerminalSession(id, processHandle, cwd, shell.label);
  registry().set(id, session);
  return session;
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return registry().get(id);
}

export function listTerminalSessions(): TerminalSession[] {
  return [...registry().values()];
}

export function closeTerminalSession(id: string): boolean {
  const session = registry().get(id);
  if (!session) return false;
  session.kill();
  registry().delete(id);
  return true;
}

export function closeAllTerminalSessions(): void {
  for (const session of registry().values()) session.kill();
  registry().clear();
}