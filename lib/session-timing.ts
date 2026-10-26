interface TimingEntry {
  type: string;
  id?: string;
  timestamp: string;
  message?: { role?: string };
}

interface TimingEntriesSource {
  getEntries(): readonly TimingEntry[];
}

/**
 * Estimate active wall-clock time from the append-only session log.
 *
 * Raw entries preserve compacted history and every executed branch exactly
 * once. Gaps ending at user messages are treated as human idle. User-initiated
 * bash entries are also boundaries because the log records only their finish
 * time, so counting the incoming gap could include arbitrary human idle.
 */
export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;

  for (const entry of entries) {
    if (!isTimingEntry(entry.type)) continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }

    if (previousTimestamp !== undefined && timestamp > previousTimestamp) {
      totalActiveMs += timestamp - previousTimestamp;
    }
    previousTimestamp = timestamp;
  }

  return totalActiveMs;
}

function isTimingEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}

const activeMsBySession = new WeakMap<TimingEntriesSource, { entryCount: number; lastEntryId: string | undefined; totalActiveMs: number }>();

/**
 * `computeSessionTotalActiveMs()` over a live session manager, reused until the
 * session gains an entry.
 *
 * The status reads that carry the value to the Session Info panel poll every
 * 600 ms while a prompt settles and every 15 s while a run is active, so
 * walking and parsing the whole entry list on each of them would block the
 * server's event loop on a long transcript (#1334). `POST /api/sessions/stats`
 * caches its summaries the same way. Entries are only appended and a rewritten
 * file keeps the session's manager, so the count and the last id identify a
 * state; a rewrite that shortens the list recomputes on the next read.
 */
export function computeLiveSessionTotalActiveMs(manager: TimingEntriesSource): number {
  const entries = manager.getEntries();
  const lastEntryId = entries[entries.length - 1]?.id;
  const cached = activeMsBySession.get(manager);
  if (cached && cached.entryCount === entries.length && cached.lastEntryId === lastEntryId) {
    return cached.totalActiveMs;
  }

  const totalActiveMs = computeSessionTotalActiveMs(entries);
  activeMsBySession.set(manager, { entryCount: entries.length, lastEntryId, totalActiveMs });
  return totalActiveMs;
}
