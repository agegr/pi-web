import { randomUUID } from "crypto";
import { statSync } from "fs";
import { homedir } from "os";
import type * as NodePty from "node-pty";

// Lazy native require: node-pty is a compiled binary and must stay external.
let ptyModule: typeof NodePty | null = null;
function loadPty(): typeof NodePty {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require("node-pty") as typeof NodePty;
  }
  return ptyModule;
}

export interface PtySession {
  readonly id: string;
  readonly cwd: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onOutput(listener: (data: string) => void): () => void;
  onExit(listener: () => void): () => void;
  takeBacklog(): string;
  isAlive(): boolean;
  /** Marks an attached stream; cancels the pending idle reclamation. */
  acquire(): void;
  /** Detaches a stream; starts the idle reclamation countdown when idle. */
  release(): void;
}

const sessions = new Map<string, PtySession & { createdAt: number }>();
const MAX_SESSIONS = 12;
// A terminal with no attached stream for this long is reclaimed (tab closed
// without a DELETE, or the browser went away entirely).
const DETACHED_RECLAIM_MS = 30_000;

function resolveShell(): string {
  return process.env.SHELL || "/bin/bash";
}

/** Resolve the requested cwd, falling back to the home directory when missing. */
export function resolvePtyCwd(requested?: string | null): string {
  if (requested && requested.trim()) {
    try {
      const stat = statSync(requested);
      if (stat.isDirectory()) return requested;
    } catch {
      // fall through to home
    }
  }
  return homedir();
}

function sweepIdleSessions(): void {
  for (const [id, session] of sessions) {
    if (!session.isAlive()) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    // Evict the oldest remaining session (all alive at this point).
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    oldest[1].kill();
  }
}

export function createPtySession(options: {
  cwd?: string | null;
  cols?: number;
  rows?: number;
}): PtySession {
  const pty = loadPty();
  const cwd = resolvePtyCwd(options.cwd);
  const cols = Math.max(2, Math.min(500, Math.floor(options.cols ?? 80)));
  const rows = Math.max(2, Math.min(300, Math.floor(options.rows ?? 24)));

  const id = randomUUID();
  const outputListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<() => void>();
  let backlog = "";
  let alive = true;
  let streamCount = 0;
  let reclaimTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelReclaim = () => {
    if (reclaimTimer !== null) {
      clearTimeout(reclaimTimer);
      reclaimTimer = null;
    }
  };

  const proc = pty.spawn(resolveShell(), [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });

  proc.onData((data: string) => {
    backlog += data;
    if (backlog.length > 256 * 1024) backlog = backlog.slice(-128 * 1024);
    for (const listener of outputListeners) listener(data);
  });

  proc.onExit(() => {
    alive = false;
    cancelReclaim();
    for (const listener of exitListeners) listener();
    setTimeout(() => sessions.delete(id), 60_000).unref?.();
  });

  const session: PtySession & { createdAt: number } = {
    id,
    cwd,
    createdAt: Date.now(),
    write: (data) => { if (alive) proc.write(data); },
    resize: (cols, rows) => {
      if (!alive) return;
      try { proc.resize(Math.max(2, cols), Math.max(2, rows)); } catch { /* exited mid-resize */ }
    },
    kill: () => {
      if (!alive) return;
      alive = false;
      cancelReclaim();
      try { proc.kill(); } catch { /* already dead */ }
      sessions.delete(id);
    },
    onOutput: (listener) => {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    takeBacklog: () => backlog,
    isAlive: () => alive,
    acquire: () => {
      streamCount += 1;
      cancelReclaim();
    },
    release: () => {
      streamCount = Math.max(0, streamCount - 1);
      if (streamCount === 0 && alive) {
        cancelReclaim();
        reclaimTimer = setTimeout(() => session.kill(), DETACHED_RECLAIM_MS);
        reclaimTimer.unref?.();
      }
    },
  };

  sessions.set(id, session);
  sweepIdleSessions();
  return session;
}

export function getPtySession(id: string): PtySession | null {
  return sessions.get(id) ?? null;
}

let shutdownHooked = false;
function hookShutdown(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const cleanup = () => { for (const s of sessions.values()) s.kill(); };
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(0); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); });
}
hookShutdown();
