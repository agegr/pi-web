import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { runShutdownCancel, runShutdownStart } from "./shutdown-commands";

export const SHUTDOWN_DEFAULT_SECONDS = 60;

export type ShutdownState = "idle" | "counting" | "done";

export interface ShutdownStatus {
  state: ShutdownState;
  remainingSeconds: number | null;
  deadline: number | null;
}

export interface ShutdownTimerDeps {
  execStart?: (seconds: number) => Promise<void>;
  execCancel?: () => Promise<void>;
  statePath?: string;
  now?: () => number;
}

interface PersistedShutdownState {
  state: "counting";
  deadline: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Owns the "shut down in N seconds" countdown.
 *
 * The countdown deadline is persisted so a server restart can re-arm the OS
 * timer instead of losing it. Only the deadline lives on disk — the OS holds
 * the actual timer, so this class never triggers a shutdown on its own.
 */
export class ShutdownTimer {
  private readonly execStart: (seconds: number) => Promise<void>;
  private readonly execCancel: () => Promise<void>;
  private readonly statePath: string;
  private readonly now: () => number;
  private state: ShutdownState = "idle";
  private deadline: number | null = null;
  private restored = false;

  constructor(deps: ShutdownTimerDeps = {}) {
    this.execStart = deps.execStart ?? runShutdownStart;
    this.execCancel = deps.execCancel ?? runShutdownCancel;
    this.statePath = deps.statePath ?? join(homedir(), ".pi", "pi-web-shutdown-state.json");
    this.now = deps.now ?? Date.now;
  }

  status(): ShutdownStatus {
    const now = this.now();
    if (this.state === "counting" && this.deadline !== null && now >= this.deadline) {
      return { state: "done", remainingSeconds: 0, deadline: this.deadline };
    }
    return {
      state: this.state,
      remainingSeconds: this.deadline === null
        ? null
        : Math.max(0, Math.ceil((this.deadline - now) / 1000)),
      deadline: this.deadline,
    };
  }

  async start(seconds = SHUTDOWN_DEFAULT_SECONDS): Promise<void> {
    this.reconcile();
    if (this.state === "counting") return;

    const deadline = this.now() + seconds * 1000;
    this.persist({ state: "counting", deadline });
    try {
      await this.execStart(seconds);
    } catch (error) {
      this.clearPersisted();
      throw error;
    }
    this.state = "counting";
    this.deadline = deadline;
  }

  async cancel(): Promise<void> {
    this.reconcile();
    if (this.state !== "counting") return;

    // A failing `shutdown /a` may still leave the OS timer armed, so the
    // countdown stays active until the cancel command actually succeeds.
    await this.execCancel();
    this.clearPersisted();
    this.state = "idle";
    this.deadline = null;
  }

  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;

    const persisted = this.loadPersisted();
    if (!persisted) return;

    const now = this.now();
    if (persisted.deadline > now) {
      const remaining = Math.max(1, Math.ceil((persisted.deadline - now) / 1000));
      try {
        await this.execStart(remaining);
      } catch {
        // The timer armed before the restart may still be pending in the OS.
      }
      this.state = "counting";
      this.deadline = persisted.deadline;
      return;
    }

    // Expired while the server was down: never power off on startup.
    this.clearPersisted();
    this.state = "idle";
    this.deadline = null;
  }

  /**
   * If the countdown deadline has passed while the server stayed up (the OS
   * shutdown was aborted externally), forget it so the user can start a new
   * countdown and cancel cleanly instead of being stuck in "counting".
   */
  private reconcile(): void {
    if (this.state === "counting" && this.deadline !== null && this.now() >= this.deadline) {
      this.clearPersisted();
      this.state = "idle";
      this.deadline = null;
    }
  }

  private persist(persisted: PersistedShutdownState): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writePrivateFileAtomicSync(this.statePath, JSON.stringify(persisted));
  }

  private loadPersisted(): PersistedShutdownState | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (!isRecord(parsed) || parsed.state !== "counting") return null;
      if (typeof parsed.deadline !== "number" || !Number.isFinite(parsed.deadline)) return null;
      return { state: "counting", deadline: parsed.deadline };
    } catch {
      return null;
    }
  }

  private clearPersisted(): void {
    try {
      rmSync(this.statePath, { force: true });
    } catch {
      // A stale state file only risks a restored countdown; never fail here.
    }
  }
}

export const shutdownTimer = new ShutdownTimer();
