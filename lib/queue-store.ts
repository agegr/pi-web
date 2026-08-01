import { randomUUID } from "crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";

/**
 * Durable store for queued (steer / follow-up) messages.
 *
 * pi keeps its steering/follow-up queues purely in memory. If the server dies
 * before a queued message is processed, that message would be lost. This module
 * mirrors the queue to a per-session sidecar file (`<session>.jsonl.queue.json`)
 * so pi-web can offer the user a manual recovery list after a restart.
 *
 * Design rules (see AGENTS.md / recovery UX):
 * - The sidecar only SAVES entries — it never auto-delivers them.
 * - After a restart every entry in the sidecar becomes a "pending recovery"
 *   item; the user decides to re-queue, discard, or export each one.
 */

export type QueueKind = "steer" | "followUp";

export interface QueueImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface QueueEntry {
  id: string;
  kind: QueueKind;
  text: string;
  images?: QueueImage[];
  queuedAt: number;
}

/** Client-supplied shape for import_queue (ids are assigned server-side). */
export interface QueueEntryInput {
  kind: QueueKind;
  text: string;
  images?: QueueImage[];
}

/** Public (non-image) view of an entry awaiting the user's recovery decision. */
export interface PendingRecoveryItem {
  id: string;
  kind: QueueKind;
  text: string;
  hasImages: boolean;
  queuedAt: number;
}

interface QueueFile {
  version: 1;
  entries: QueueEntry[];
}

export function queueSidecarPath(sessionFile: string): string {
  return `${sessionFile}.queue.json`;
}

export function createQueueEntry(
  kind: QueueKind,
  text: string,
  images?: QueueImage[],
): QueueEntry {
  return {
    id: randomUUID(),
    kind,
    text,
    ...(images && images.length > 0 ? { images } : {}),
    queuedAt: Date.now(),
  };
}

export function loadQueue(sessionFile: string): QueueEntry[] {
  const path = queueSidecarPath(sessionFile);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<QueueFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (e): e is QueueEntry =>
        Boolean(e) &&
        (e.kind === "steer" || e.kind === "followUp") &&
        typeof e.text === "string",
    );
  } catch {
    // Corrupt sidecar — treat as empty rather than blocking the session.
    return [];
  }
}

/** Atomically replace the sidecar (tmp file + rename). */
export function saveQueue(sessionFile: string, entries: QueueEntry[]): void {
  if (!sessionFile) return;
  const path = queueSidecarPath(sessionFile);
  const payload: QueueFile = { version: 1, entries };
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(tmp, JSON.stringify(payload), "utf8");
    renameSync(tmp, path);
  } catch (error) {
    // Any failure must not crash the session; best-effort cleanup of tmp.
    try {
      rmSync(tmp, { force: true });
    } catch { /* ignore */ }
    console.error(
      `[pi-web] failed to persist queue sidecar ${path}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function removeQueue(sessionFile: string): void {
  try {
    rmSync(queueSidecarPath(sessionFile), { force: true });
  } catch { /* ignore */ }
}
