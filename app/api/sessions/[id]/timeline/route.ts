import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionIndexSettings } from "@/lib/index-settings";
import { isIndexAvailable, initSchema, getEntryTimeline } from "@/lib/session-index";
import { jsonResponse } from "@/lib/json-response";

/**
 * Lightweight metadata for one message in the session timeline.
 * Used by the ChatMinimap to show ALL nodes without loading full content.
 *
 * The timeline is grouped into conversational turns: one user node + one
 * assistant node. Tool-call-only assistant messages are collapsed into the
 * following answer (exposed as `toolCount`), so the minimap shows "一发一回"
 * instead of a stream of [bash]/[read] dots.
 */
export interface TimelineItem {
  entryId: string;
  role: "user" | "assistant" | "compaction";
  timestamp: string;
  preview: string;
  lineIndex: number;
  /** True when this entry was compacted away (not individually loadable). */
  compacted: boolean;
  /** When compacted, the compaction entry ID that summarizes this message. */
  compactionId?: string;
  /** Assistant node: number of collapsed tool-call messages in this reply. */
  toolCount?: number;
  /** Assistant node: whether the reply carries a text answer. */
  hasText?: boolean;
}

/** Normalized entry shape shared by the index and file paths. */
interface RawEntry {
  id: string;
  role: "user" | "assistant" | "compaction";
  type: string;
  lineIndex: number;
  timestamp: string;
  contentPreview: string;
  firstKeptEntryId: string | null;
  hasText: boolean;
}

/**
 * Given ordered entries, mark which are compacted by a subsequent compaction
 * entry. An entry is compacted if some compaction C (C after the entry) has
 * firstKeptEntryId past the entry's lineIndex.
 */
function applyCompaction(
  entries: RawEntry[],
): (e: RawEntry) => { compacted: boolean; compactionId?: string } {
  const compactions = entries
    .filter((e) => e.type === "compaction")
    .sort((a, b) => a.lineIndex - b.lineIndex);
  const lineMap = new Map(entries.map((e) => [e.id, e.lineIndex]));

  return (entry) => {
    if (entry.type === "compaction") return { compacted: false };
    for (const c of compactions) {
      if (c.lineIndex <= entry.lineIndex) continue;
      const firstKeptLine = lineMap.get(c.firstKeptEntryId ?? "") ?? Infinity;
      if (entry.lineIndex < firstKeptLine) {
        return { compacted: true, compactionId: c.id };
      }
    }
    return { compacted: false };
  };
}

/** Group raw ordered entries into user/assistant turns, collapsing
 * tool-call-only assistant messages into their turn's answer. */
function groupTimeline(raw: RawEntry[]): TimelineItem[] {
  const compactCheck = applyCompaction(raw);
  const out: TimelineItem[] = [];

  // Accumulators for the in-progress assistant turn.
  let toolNames: string[] = [];
  let answer: RawEntry | null = null; // most recent assistant entry with text
  let lastAssistant: RawEntry | null = null;

  const flushAssistant = () => {
    if (!lastAssistant) return;
    const base = answer ?? lastAssistant;
    const c = compactCheck(base);
    let preview = "";
    let hasText = false;
    if (answer) {
      preview = answer.contentPreview;
      hasText = true;
    } else if (toolNames.length > 0) {
      const shown = toolNames.slice(0, 3).join(", ");
      preview = toolNames.length > 3 ? `[${shown}, …]` : `[${shown}]`;
    } else {
      preview = lastAssistant.contentPreview;
      hasText = lastAssistant.hasText;
    }
    out.push({
      entryId: base.id,
      role: "assistant",
      timestamp: base.timestamp,
      preview,
      lineIndex: base.lineIndex,
      compacted: c.compacted,
      compactionId: c.compactionId,
      toolCount: toolNames.length,
      hasText,
    });
    toolNames = [];
    answer = null;
    lastAssistant = null;
  };

  for (const e of raw) {
    if (e.role === "user") {
      flushAssistant();
      const c = compactCheck(e);
      out.push({
        entryId: e.id,
        role: "user",
        timestamp: e.timestamp,
        preview: e.contentPreview,
        lineIndex: e.lineIndex,
        compacted: c.compacted,
        compactionId: c.compactionId,
        hasText: e.hasText,
      });
    } else if (e.role === "assistant") {
      if (e.hasText) {
        answer = e;
      } else {
        // Pure tool-call message: accumulate its tool name for the group.
        const name = e.contentPreview.replace(/^\[|\]$/g, "").trim();
        if (name) toolNames.push(name);
      }
      lastAssistant = e;
    } else if (e.type === "compaction") {
      flushAssistant();
      out.push({
        entryId: e.id,
        role: "compaction",
        timestamp: e.timestamp,
        preview: e.contentPreview,
        lineIndex: e.lineIndex,
        compacted: false,
      });
    }
  }
  flushAssistant();
  return out;
}

/** Build the grouped timeline from raw entries (shared by both data paths). */
function buildTimeline(raw: RawEntry[]): TimelineItem[] {
  // Keep only user / assistant / compaction entries (toolResult already
  // excluded from both data paths), then group into turns.
  const relevant = raw.filter(
    (e) => e.role === "user" || e.role === "assistant" || e.type === "compaction",
  );
  return groupTimeline(relevant);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // A live RPC session's index lags behind (new messages are not yet
    // incrementally indexed). Read live data directly so the minimap shows
    // the latest turn; historical (non-live) sessions use the fast SQLite
    // path.
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;

    // Try SQLite index first (fast, full timeline) — for non-live sessions.
    if (!liveRpc) {
      try {
        const settings = await readSessionIndexSettings();
        if (settings.enabled && isIndexAvailable()) {
          initSchema();
          const entries = getEntryTimeline(id, 10000);
          const raw: RawEntry[] = entries.map((e) => ({
            id: e.id,
            role: e.type === "compaction"
              ? "compaction"
              : ((e.role ?? "assistant") as "user" | "assistant"),
            type: e.type,
            lineIndex: e.lineIndex,
            timestamp: e.timestamp,
            contentPreview: e.contentPreview,
            firstKeptEntryId: e.firstKeptEntryId ?? null,
            hasText: e.hasText ?? false,
          }));
          const timeline = buildTimeline(raw);
          if (timeline.length > 0) {
            return jsonResponse(req, { timeline, total: timeline.length });
          }
        }
      } catch {
        // Fall through to JSONL scan
      }
    }

    // Live or index-miss: scan the session file / live entries directly.
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const rawEntries = sm.getEntries();

    const raw: RawEntry[] = [];
    let lineIndex = 0;
    for (const entry of rawEntries) {
      lineIndex++;
      const type = entry.type;
      if (type !== "message" && type !== "compaction") continue;

      if (type === "compaction") {
        const summary = typeof entry.summary === "string" ? entry.summary : "";
        raw.push({
          id: entry.id,
          role: "compaction",
          type: "compaction",
          lineIndex,
          timestamp: entry.timestamp,
          contentPreview: summary.length > 200 ? summary.slice(0, 200) + "…" : summary,
          firstKeptEntryId: typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : null,
          hasText: false,
        });
        continue;
      }

      const role = (entry.message as { role?: string }).role;
      if (role !== "user" && role !== "assistant") continue;

      const message = entry.message as unknown as { content?: unknown };
      const content = message.content;
      // A text block with non-whitespace text → hasText; otherwise tool-only.
      let hasText = false;
      let preview = "";
      if (typeof content === "string") {
        preview = content;
        hasText = preview.trim().length > 0;
      } else if (Array.isArray(content)) {
        const textBlock = content.find(
          (b: { type?: string; text?: string }) => (
            b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0
          ),
        );
        if (textBlock) {
          preview = textBlock.text!;
          hasText = true;
        } else if (role === "assistant") {
          const tools = content
            .filter((b: { type?: string }) => b.type === "toolCall" || b.type === "tool_use")
            .map((b: { name?: string }) => b.name)
            .filter((n): n is string => typeof n === "string" && n.length > 0);
          if (tools.length > 0) preview = `[${tools.join(", ")}]`;
        }
      }
      preview = preview.trim();
      if (preview.length > 200) preview = preview.slice(0, 200) + "…";

      raw.push({
        id: entry.id,
        role: role as "user" | "assistant",
        type: "message",
        lineIndex,
        timestamp: entry.timestamp,
        contentPreview: preview,
        firstKeptEntryId: null,
        hasText,
      });
    }

    const timeline = buildTimeline(raw);
    return jsonResponse(req, { timeline, total: timeline.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
