import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 10_000;
const DEFAULT_GIT_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_CONCURRENT_GIT_PROCESSES = 8;

interface GitProcessState {
  active: number;
  peakActive: number;
  started: number;
  waiters: Array<() => void>;
}

declare global {
  var __piGitProcessState: GitProcessState | undefined;
}

function state(): GitProcessState {
  if (!globalThis.__piGitProcessState) {
    globalThis.__piGitProcessState = { active: 0, peakActive: 0, started: 0, waiters: [] };
  }
  globalThis.__piGitProcessState.peakActive ??= globalThis.__piGitProcessState.active;
  return globalThis.__piGitProcessState;
}

async function acquire(): Promise<void> {
  const current = state();
  if (current.active < MAX_CONCURRENT_GIT_PROCESSES) {
    current.active += 1;
    current.peakActive = Math.max(current.peakActive, current.active);
    return;
  }
  await new Promise<void>((resolve) => current.waiters.push(resolve));
}

function release(): void {
  const current = state();
  const next = current.waiters.shift();
  if (next) {
    next();
    return;
  }
  current.active = Math.max(0, current.active - 1);
}

export async function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<string> {
  await acquire();
  const current = state();
  current.started += 1;
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout;
  } finally {
    release();
  }
}

export function gitProcessStats(): {
  active: number;
  peakActive: number;
  queued: number;
  started: number;
  limit: number;
} {
  const current = state();
  return {
    active: current.active,
    peakActive: current.peakActive,
    queued: current.waiters.length,
    started: current.started,
    limit: MAX_CONCURRENT_GIT_PROCESSES,
  };
}
