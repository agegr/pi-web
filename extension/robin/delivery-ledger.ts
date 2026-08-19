/**
 * A delivery ledger: which chat ids have already received which run.
 *
 * One generic module replaces the three near-identical stores that grew up as
 * the digests did (daily agenda, job digest, gmail digest). The interface is
 * two methods — `pending` and `mark` — and everything else (file format, the
 * single-run migration, history trimming) sits behind it.
 *
 * Server-only: reaches node:fs through ./paths.ts. The interface is small and
 * stable, so the Telegram bridge and its tests build in-memory adapters of the
 * same shape.
 */
import { readJsonObject, writeJsonObject } from "./paths.ts";

/** How many past runs to keep. Keys sort chronologically, so the oldest drop. */
const HISTORY = 20;

export interface DeliveryLedger {
  /** The chat ids in `audience` that have not yet been delivered for `key`. */
  pending(key: string, audience: number[]): number[];
  /** Record that `chatId` received `key`, once. */
  mark(key: string, chatId: number): void;
}

interface StoredRuns {
  runs?: Record<string, number[]>;
  /** Two older single-run shapes, migrated on read. */
  date?: string; // daily agenda once wrote { date, chatIds }
  runKey?: string; // job digest once wrote { runKey, chatIds }
  chatIds?: number[];
}

export function createDeliveryLedger(file: string): DeliveryLedger {
  function read(): Record<string, number[]> {
    const stored = readJsonObject<StoredRuns>(file);
    if (!stored) return {};
    if (stored.runs && typeof stored.runs === "object") return stored.runs;
    // Migrate a single-run shape in place on read, so an upgrade does not
    // re-send whatever that last run was.
    const key = typeof stored.runKey === "string"
      ? stored.runKey
      : typeof stored.date === "string"
        ? stored.date
        : null;
    if (key) return { [key]: Array.isArray(stored.chatIds) ? stored.chatIds : [] };
    return {};
  }

  function write(runs: Record<string, number[]>): void {
    const trimmed = Object.fromEntries(
      Object.entries(runs).sort(([a], [b]) => a.localeCompare(b)).slice(-HISTORY),
    );
    writeJsonObject(file, { runs: trimmed });
  }

  return {
    pending(key, audience) {
      const sent = read()[key] ?? [];
      return audience.filter((chatId) => !sent.includes(chatId));
    },
    mark(key, chatId) {
      const runs = read();
      const sent = runs[key] ?? [];
      if (sent.includes(chatId)) return;
      write({ ...runs, [key]: [...sent, chatId] });
    },
  };
}
