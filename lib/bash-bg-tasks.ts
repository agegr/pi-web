import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BG_TASK_NOTIFICATION_CUSTOM_TYPE } from "./bg-task-notification";

/**
 * Foreground bash commands that outlive this switch to background mode, where
 * the process keeps running and the turn is released. Stated in the tool's
 * prompt so the model knows the number instead of discovering it.
 */
export const FOREGROUND_AUTO_BACKGROUND_MS = 120_000;

/** Cap on the pre-handoff output kept in memory before it spills to the log file. */
const BUFFER_CAP_BYTES = 4 * 1024 * 1024;

const BG_LOG_DIR = join(tmpdir(), "pi-web-bg-tasks");

export function bgLogPath(): string {
  mkdirSync(BG_LOG_DIR, { recursive: true });
  return join(BG_LOG_DIR, `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.log`);
}

/** Raw stdout/stderr chunks captured before a foreground command hands off to background. */
export class PreHandoffBuffer {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private overflowed = false;

  push(data: Buffer): void {
    if (this.bytes >= BUFFER_CAP_BYTES) {
      this.overflowed = true;
      return;
    }
    this.chunks.push(Buffer.from(data));
    this.bytes += data.length;
  }

  /** Every buffered chunk, oldest first. After overflow a marker replaces the head. */
  dump(): Buffer[] {
    const parts = [...this.chunks];
    if (this.overflowed) {
      parts.unshift(Buffer.from(`[... earlier output truncated ...]\n`));
    }
    return parts;
  }
}

interface HostSession {
  readonly inner: {
    sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: undefined }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void>;
  };
  isAlive(): boolean;
  isRunning(): boolean;
  waitUntilReady(): Promise<void>;
}

export interface BgTaskNotifierDependencies {
  getSession(sessionId: string): HostSession | undefined;
  reopenSession(sessionId: string, sessionFile: string): Promise<HostSession>;
  resolveSessionPath(sessionId: string): Promise<string | null>;
}

export interface BgTaskNotifier {
  notify(sessionId: string, text: string): Promise<void>;
}

export function createBgTaskNotifier(deps: BgTaskNotifierDependencies): BgTaskNotifier {
  return {
    async notify(sessionId, text) {
      let session = deps.getSession(sessionId);
      if (!session?.isAlive()) {
        const sessionFile = await deps.resolveSessionPath(sessionId);
        if (!sessionFile) return;
        session = await deps.reopenSession(sessionId, sessionFile);
      }
      await session.waitUntilReady();
      // Do not interrupt an in-flight turn: deliver once the parent is idle.
      while (session.isAlive() && session.isRunning()) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 200); });
      }
      if (!session.isAlive()) return;
      await session.inner.sendCustomMessage(
        { customType: BG_TASK_NOTIFICATION_CUSTOM_TYPE, content: text, display: true, details: undefined },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  };
}

/** Abort controllers of live background tasks, so a destroyed session does not orphan them. */
const sessionBgControllers = new Map<string, Set<AbortController>>();

export function trackBgTask(sessionId: string, controller: AbortController): void {
  let set = sessionBgControllers.get(sessionId);
  if (!set) {
    set = new Set();
    sessionBgControllers.set(sessionId, set);
  }
  set.add(controller);
}

export function untrackBgTask(sessionId: string, controller: AbortController): void {
  const set = sessionBgControllers.get(sessionId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) sessionBgControllers.delete(sessionId);
}

export function killBgTasksForSession(sessionId: string): void {
  const set = sessionBgControllers.get(sessionId);
  if (!set) return;
  sessionBgControllers.delete(sessionId);
  for (const controller of set) controller.abort();
}
