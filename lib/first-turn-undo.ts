export interface FirstTurnUndoTarget {
  entryId: string;
  leafId: string;
}

interface Entry {
  type: string;
  id: string;
  parentId: string | null;
  message?: { role?: string; content?: unknown; stopReason?: string };
}

const INITIAL_METADATA = new Set(["model_change", "thinking_level_change", "session_info", "custom"]);

/** A deliberately narrow operation: one original, linear, tool-free aborted turn. */
export function getFirstTurnUndoTarget(
  header: { parentSession?: string } | null,
  entries: readonly unknown[],
  leafId: string | null,
): FirstTurnUndoTarget | null {
  if (!header || header.parentSession) return null;
  let previous: string | null = null;
  let user: Entry | undefined;
  let assistant: Entry | undefined;
  const ids = new Set<string>();
  for (const value of entries) {
    if (!value || typeof value !== "object") return null;
    const entry = value as Entry;
    if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || entry.parentId !== previous) return null;
    ids.add(entry.id);
    previous = entry.id;
    if (!user && INITIAL_METADATA.has(entry.type)) continue;
    if (!user && entry.type === "message" && entry.message?.role === "user") {
      user = entry;
      continue;
    }
    if (!user || assistant || entry.type !== "message" || entry.message?.role !== "assistant") return null;
    if (entry.message.stopReason !== "aborted" || !Array.isArray(entry.message.content)) return null;
    if (entry.message.content.some((block) => !block || !["text", "thinking"].includes(block.type))) return null;
    assistant = entry;
  }
  return user && assistant && assistant.id === leafId ? { entryId: user.id, leafId: assistant.id } : null;
}

/** Preserve the header and pre-prompt settings verbatim; create no history branch. */
export function planFirstTurnUndo(source: string, sessionId: string, expected: FirstTurnUndoTarget): string {
  const lines = source.trimEnd().split("\n");
  const [header, ...entries] = lines.map((line) => JSON.parse(line));
  if (header?.type !== "session" || header.version !== 3 || header.id !== sessionId) {
    throw new Error("Unsupported or mismatched session");
  }
  const target = getFirstTurnUndoTarget(header, entries, expected.leafId);
  if (!target || target.entryId !== expected.entryId) {
    throw new Error("Only the original, unbranched, tool-free aborted first turn can be undone");
  }
  const userIndex = entries.findIndex((entry) => entry.id === target.entryId);
  return lines.slice(0, userIndex + 1).join("\n") + "\n";
}
