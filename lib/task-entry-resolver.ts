/**
 * Map a todo taskId to the session entry that last mentioned it.
 *
 * Walks SessionEntry[] (from getSessionEntries) and returns the latest
 * entry whose `message` is a toolResult from the `todo` tool AND whose
 * `message.details.tasks` array contains an entry with the matching id.
 *
 * The function deliberately does not filter out "deleted" tombstones:
 * the latest reference wins, even if the most recent snapshot marked
 * the task as deleted. UI layers that hide deleted tasks should filter
 * at display time; this resolver stays pure and lets callers decide.
 *
 * Why "latest": rpiv-todo (and any reasonable todo tool) sends a full
 * snapshot on every update. So task 1 appears in the create entry,
 * the progress-update entry, the complete entry, and possibly a delete
 * entry. The one the user actually wants to scroll to is whichever
 * snapshot is closest in time to "now" for that taskId — i.e. the
 * latest one.
 */

interface TodoTaskLike {
  id: number;
  status?: string;
}

interface TodoDetailsLike {
  tasks: TodoTaskLike[];
  nextId: number;
}

/**
 * Minimal shape this resolver reads from a SessionEntry. Typed loosely
 * on purpose: the real `SessionEntry` from lib/types.ts has many more
 * fields, but the resolver only touches a handful, and we don't want to
 * import the heavy type here (it pulls in pi-coding-agent types).
 */
export interface ResolverEntry {
  type?: string;
  message?: {
    role?: string;
    toolName?: string;
    details?: unknown;
  };
}

function isTodoDetails(d: unknown): d is TodoDetailsLike {
  if (typeof d !== "object" || d === null) return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.tasks) && typeof obj.nextId === "number";
}

/**
 * Return the latest entry mentioning `taskId`, or null if none.
 * Time complexity: O(n) over the entries — fine for sessions with
 * thousands of entries since we typically call this once per click.
 */
export function findEntryForTask<T extends ResolverEntry>(
  entries: readonly T[],
  taskId: number,
): T | null {
  let toolResultIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const msg = entries[i].message;
    if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
    if (!isTodoDetails(msg.details)) continue;
    if (!msg.details.tasks.some((t) => t.id === taskId)) continue;
    if (toolResultIdx === -1) toolResultIdx = i; // first match wins（创建时，让不同 task 跳各自创建消息）
  }
  if (toolResultIdx === -1) return null;
  // 往前找最近的 user/assistant entry 作为跳转目标——toolResult 不单独渲染
  // （作为 assistant 的附属），跳到所属 user/assistant 才能命中 ChatWindow
  // 的 register（只挂 user/assistant DOM）。
  for (let i = toolResultIdx; i >= 0; i--) {
    const role = entries[i].message?.role;
    if (role === "user" || role === "assistant") return entries[i];
  }
  return entries[toolResultIdx];
}
