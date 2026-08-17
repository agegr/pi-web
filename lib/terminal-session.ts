import type { IPty } from "node-pty";

const MAX_BUFFER_BYTES = 1_048_576;
export const MAX_INPUT_BYTES = 65_536;
/**
 * A PTY has to outlive its viewer. The panel drops its SSE stream whenever its
 * tab is backgrounded — browsers allow only six concurrent HTTP/1.1 streams per
 * origin, so a stream per open terminal would starve the rest of the app — which
 * means "nobody is watching" has to be measured in minutes, not seconds.
 *
 * While a viewer *is* attached there is no timeout at all. Killing a shell that
 * happens to be waiting on a long silent build is far worse than holding an idle
 * bash process, and the terminal count is capped elsewhere.
 */
export const DETACHED_TIMEOUT_MS = 15 * 60_000;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;

export type TerminalEvent =
  | { seq: number; type: "output"; data: string }
  | { seq: number; type: "reset" }
  | { seq: number; type: "exit"; exitCode: number; signal?: number; reason?: "detached" };

export interface TerminalDescriptor {
  terminalId: string;
  sessionId: string;
  cwd: string;
  columns: number;
  rows: number;
}

type TerminalEventInput =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number; reason?: "detached" };

type TerminalListener = (event: TerminalEvent) => void;

export function validateDimensions(columns: number, rows: number): void {
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    throw new Error(`Terminal columns must be between ${MIN_COLUMNS} and ${MAX_COLUMNS}`);
  }
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new Error(`Terminal rows must be between ${MIN_ROWS} and ${MAX_ROWS}`);
  }
}

/**
 * Keep the last `maxBytes` of UTF-8 text without slicing a multi-byte sequence
 * in half, which would otherwise surface as replacement characters mid-glyph.
 */
export function utf8Tail(data: string, maxBytes: number): string {
  const bytes = Buffer.from(data, "utf8");
  if (bytes.length <= maxBytes) return data;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

/**
 * One PTY plus the replay buffer that lets a viewer reattach to it. Kept free of
 * filesystem, session and node-pty imports so it can be exercised directly.
 */
export class ManagedTerminal {
  readonly descriptor: TerminalDescriptor;
  private readonly listeners = new Set<TerminalListener>();
  private readonly frames: TerminalEvent[] = [];
  private bufferedBytes = 0;
  private sequence = 0;
  /** Highest sequence number evicted from the replay buffer. */
  private droppedThrough = 0;
  private alive = true;
  private detachTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pty: IPty;
  private readonly onClosed: () => void;

  // Written out rather than declared as constructor parameter properties: the
  // test runner strips types without transforming, and that syntax needs a
  // transform, which is what kept this class untested.
  constructor(pty: IPty, descriptor: TerminalDescriptor, onClosed: () => void) {
    this.pty = pty;
    this.descriptor = descriptor;
    this.onClosed = onClosed;
    pty.onData((data) => this.publish({ type: "output", data }));
    pty.onExit(({ exitCode, signal }) => {
      if (!this.alive) return;
      this.alive = false;
      this.clearTimers();
      this.publish({ type: "exit", exitCode, ...(signal ? { signal } : {}) });
      this.onClosed();
    });
    this.scheduleDetachedClose();
  }

  isAlive(): boolean {
    return this.alive;
  }

  write(data: string): void {
    if (!this.alive) throw new Error("Terminal has exited");
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) throw new Error("Terminal input is too large");
    this.pty.write(data);
  }

  resize(columns: number, rows: number): void {
    if (!this.alive) throw new Error("Terminal has exited");
    validateDimensions(columns, rows);
    this.descriptor.columns = columns;
    this.descriptor.rows = rows;
    this.pty.resize(columns, rows);
  }

  subscribe(afterSequence: number, listener: TerminalListener): () => void {
    if (this.detachTimer) clearTimeout(this.detachTimer);
    this.detachTimer = null;
    // Frames the viewer never saw have already been evicted, so the byte stream
    // it is about to receive does not continue the one on its screen. Replaying
    // into a half-finished escape sequence garbles the display; tell it to reset.
    if (afterSequence < this.droppedThrough) listener({ seq: afterSequence, type: "reset" });
    for (const frame of this.frames) {
      if (frame.seq > afterSequence) listener(frame);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.scheduleDetachedClose();
    };
  }

  close(reason?: "detached"): void {
    if (!this.alive) return;
    this.alive = false;
    this.clearTimers();
    this.publish({ type: "exit", exitCode: 0, signal: 15, ...(reason ? { reason } : {}) });
    try { this.pty.kill(); } catch { /* process already exited */ }
    this.onClosed();
  }

  private publish(event: TerminalEventInput): void {
    if (event.type === "output") {
      const trimmed = utf8Tail(event.data, MAX_BUFFER_BYTES);
      if (trimmed !== event.data) event = { type: "output", data: trimmed };
    }
    const frame = { ...event, seq: ++this.sequence } as TerminalEvent;
    this.frames.push(frame);
    this.bufferedBytes += frame.type === "output" ? Buffer.byteLength(frame.data, "utf8") : 0;
    while (this.bufferedBytes > MAX_BUFFER_BYTES && this.frames.length > 1) {
      const removed = this.frames.shift();
      if (!removed) break;
      if (removed.type === "output") this.bufferedBytes -= Buffer.byteLength(removed.data, "utf8");
      this.droppedThrough = removed.seq;
    }
    for (const listener of this.listeners) listener(frame);
  }

  private scheduleDetachedClose(): void {
    if (!this.alive || this.listeners.size > 0) return;
    if (this.detachTimer) clearTimeout(this.detachTimer);
    this.detachTimer = setTimeout(() => this.close("detached"), DETACHED_TIMEOUT_MS);
    this.detachTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.detachTimer) clearTimeout(this.detachTimer);
    this.detachTimer = null;
  }
}
