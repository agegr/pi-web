/**
 * The bridge's daily scheduling: which digests are due, and which chats still
 * need them.
 *
 * One module replaces the four near-identical run-key / pending blocks that
 * grew up as each digest was added. The interface is `runIfDue` — everything
 * else (slot arithmetic, the latest-due rule, the pending filter) sits behind
 * it, so a new digest is a list of slots and a send function, nothing more.
 */
import { localDate } from "../../extension/robin/dates.ts";
import type { DeliveryLedger } from "../../extension/robin/delivery-ledger.ts";

/** A named wall-clock time. `key` is the suffix of the run key (empty → bare date). */
export interface Slot {
  key: string;
  /** Local wall-clock time, HH:MM. */
  at: string;
}

function clockTime(now: number): string {
  const at = new Date(now);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * The run key of the latest due slot, or null.
 *
 * Only the LATEST due slot fires. Starting the bridge at nine in the evening
 * should send the evening digest, not the morning one it missed and then the
 * evening one on top of it. A single-slot schedule is just the one-slot case.
 */
export function runKey(slots: Slot[], now: number): string | null {
  if (slots.length === 0) return null;
  const time = clockTime(now);
  const due = slots
    .filter((slot) => time >= slot.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const latest = due.at(-1);
  if (!latest) return null;
  const date = localDate(new Date(now));
  return latest.key ? `${date}:${latest.key}` : date;
}

/**
 * Run `run` for the chats that are due and not yet delivered.
 *
 * Deep on purpose: the caller hands over a ledger, an audience, and a list of
 * slots, and gets back "whatever needs sending, sent". The gate — audience
 * empty? due? pending? — is the behaviour that used to be repeated at every
 * call site.
 */
export async function runIfDue(
  ledger: DeliveryLedger,
  audience: number[],
  slots: Slot[],
  now: number,
  run: (key: string, chats: number[]) => Promise<void>,
): Promise<void> {
  if (audience.length === 0) return;
  const key = runKey(slots, now);
  if (!key) return;
  const pending = ledger.pending(key, audience);
  if (pending.length > 0) await run(key, pending);
}
