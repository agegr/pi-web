import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";
import { resolveSessionPath, invalidateSessionPathCache, invalidateSessionListCache, cacheSessionPath } from "@/lib/session-reader";
import { readSubagentRun } from "@/lib/subagents";
import { sessionPathKey } from "@/lib/session-path";
import type { SessionEntry, SessionHeader } from "@/lib/types";

/**
 * Merge several sessions into one, and judge whether they are similar enough
 * to suggest merging at all.
 *
 * A user opens several sessions for what turns out to be the same task, then
 * wants a single session back. Similarity is judged on the session files'
 * content itself (user messages, assistant text, the tools they call and the
 * results they get), not on metadata: two sessions about the same thing read
 * and edit the same files and say similar things. The merge is a copy-style
 * concatenation: session A's entries keep their tree, each following session
 * is appended after A's last entry, its entry ids regenerated so the merged
 * file stays a valid tree, with a custom message marking where it came from.
 */

/** A pairwise similarity verdict for two sessions. */
export interface SessionPairSimilarity {
  aId: string;
  bId: string;
  /** 0..1; 1 = identical content. */
  score: number;
  /** Human-readable reason (already localised fields; server returns keys). */
  reason: string;
  /** Fraction of the pair's shared fingerprint tokens, for the progress bar. */
  shared: number;
}

export interface SessionMergePreview {
  pairs: SessionPairSimilarity[];
  /** Mean score across pairs; the UI's headline number. */
  overall: number;
  /** True when every pair clears the suggestion threshold. */
  suggested: boolean;
  /** True when every selected session lives under the same cwd. */
  sameDirectory: boolean;
  /** True when any selected session carries subagent metadata; merge refuses. */
  hasSubagent: boolean;
}

export class SessionMergeError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "too_few"
      | "transient"
      | "unsaved"
      | "subagent"
      | "not_similar"
      | "cross_cwd",
    message: string,
  ) {
    super(message);
    this.name = "SessionMergeError";
  }
}

const SUGGEST_THRESHOLD = 0.45;
const WARN_THRESHOLD = 0.25;

// ────────────────────────────────────────────────────────────────────────────
// Similarity
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the meaningful text of a session into one string: user messages,
 * assistant text blocks, the tools called (name + serialised input) and the
 * text they returned. Tool input usually carries the file paths and commands
 * that identify "the same task"; helper blocks and metadata are skipped.
 */
function sessionContentText(entries: readonly SessionEntry[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = (entry as { message: { role: string; content?: unknown; toolCallId?: string; toolName?: string; command?: string } }).message;
    if (!message) continue;
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content as Array<{ type?: string; text?: string; toolName?: string; input?: unknown; command?: string; path?: string }>) {
        if (typeof block.text === "string" && block.text.trim()) {
          parts.push(block.text);
        } else if (block.type === "toolCall") {
          parts.push(`${block.toolName ?? ""} ${String(block.input ?? "")}`);
        } else if (block.type === "tool_result" && typeof block.command === "string") {
          parts.push(block.command);
        }
      }
    } else if (typeof content === "string" && content.trim()) {
      parts.push(content);
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      parts.push(`tool ${message.toolCallId} ${message.toolName ?? ""}`);
    }
  }
  return parts.join("\n");
}

/**
 * Fingerprint a text as an unordered bag of shingles, suited to both English
 * and Chinese: ASCII runs (words, identifiers, paths) plus every CJK
 * character bigram (language without spaces). Lowercased, punctuation
 * dropped.
 */
export function textShingles(text: string): Set<string> {
  const shingles = new Set<string>();
  const lower = text.toLowerCase();
  // ASCII words / identifiers / paths, including the separators that make
  // "src/lib/a.ts" differ from "src/lib/b.ts".
  const ascii = lower.match(/[a-z0-9][a-z0-9._\-/]*/g) ?? [];
  for (const run of ascii) {
    if (run.length <= 32) shingles.add(`a:${run}`);
    for (let i = 0; i <= run.length - 8; i += 4) shingles.add(`a:${run.slice(i, i + 8)}`);
  }
  // CJK runs, cut into overlapping bigrams.
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) shingles.add(`c:${run}`);
    for (let i = 0; i < run.length - 1; i += 1) shingles.add(`c:${run.slice(i, i + 2)}`);
  }
  return shingles;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const shingle of a) if (b.has(shingle)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Similarity of two sessions' content, ~length-independent: Dice over the
 * whole fingerprint bag, which mixes user intent, assistant text and the
 * tools/files both sessions touched. `shared` is the same coefficient, used
 * by the UI for the pair's progress bar.
 */
function contentSimilarity(aText: string, bText: string): { score: number; shared: number } {
  const a = textShingles(aText);
  const b = textShingles(bText);
  const score = dice(a, b);
  return { score, shared: score };
}

function similarityReason(score: number): string {
  if (score >= SUGGEST_THRESHOLD) return "merge.similaritySuggest";
  if (score >= WARN_THRESHOLD) return "merge.similarityWarn";
  return "merge.similarityWeak";
}

/** Preview (or re-check during execution): pairwise similarity over the given session ids. */
export async function previewSessionMerge(ids: string[]): Promise<SessionMergePreview> {
  if (ids.length < 2) throw new SessionMergeError("too_few", "Select at least two sessions to compare.");
  const paths = await Promise.all(ids.map(async (id) => {
    const path = await resolveSessionPath(id);
    if (!path) throw new SessionMergeError("not_found", `Session not found: ${id}`);
    return path;
  }));
  const opened = await Promise.all(paths.map(async (path) => {
    const manager = SessionManager.open(path);
    const entries = manager.getEntries() as unknown as SessionEntry[];
    return {
      text: sessionContentText(entries),
      cwd: manager.getHeader()?.cwd ?? null,
      isSubagent: readSubagentRun(entries, "", path) !== null,
    };
  }));
  const texts = opened.map((item) => item.text);
  const sameDirectory = opened.length > 0
    && opened.every((item) => item.cwd !== null && item.cwd === opened[0].cwd);
  const hasSubagent = opened.some((item) => item.isSubagent);

  const pairs: SessionPairSimilarity[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const { score, shared } = contentSimilarity(texts[i], texts[j]);
      pairs.push({
        aId: ids[i],
        bId: ids[j],
        score,
        reason: similarityReason(score),
        shared,
      });
    }
  }
  const overall = pairs.length === 0 ? 0 : pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length;
  return {
    pairs,
    overall,
    suggested: pairs.every((pair) => pair.score >= SUGGEST_THRESHOLD),
    sameDirectory,
    hasSubagent,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Merge
// ────────────────────────────────────────────────────────────────────────────

/**
 * Regenerate ids for a session's entries, keeping the tree intact: every
 * entry gets a fresh id, and parent links *within* the session are rewritten
 * to the fresh ids so branch shape survives the move. The appended session's
 * `session_info` entries are dropped: they name the source, not the merged
 * file, and the SDK would otherwise adopt the newest one as the merged
 * session's display title.
 */
function remapIds(entries: readonly SessionEntry[]): {
  entries: SessionEntry[];
  rootId: string;
} {
  const used = new Set<string>();
  const next = () => {
    let id: string;
    do { id = randomUUID().slice(0, 8); } while (used.has(id));
    used.add(id);
    return id;
  };
  const kept = entries.filter((entry) => entry.type !== "session_info");
  const idForward = new Map<string, string>(); // old id -> fresh id
  const remapped = kept.map((entry) => {
    const newId = next();
    idForward.set(entry.id, newId);
    return { ...entry, id: newId };
  });
  const relinked = remapped.map((entry) => {
    const parentId = entry.parentId && idForward.get(entry.parentId);
    // A parent outside the appended session (should not happen for a saved
    // file) is left as-is; the caller only rewires the root.
    return parentId ? { ...entry, parentId } : entry;
  });
  const rootId = relinked.length > 0 ? relinked[0].id : "";
  return { entries: relinked, rootId };
}

/**
 * Build the merged file's lines. `main` keeps its tree untouched; each
 * appended session is parented to the last written entry, with a marker
 * custom message naming the source.
 */
function mergedFileLines(
  mainHeader: SessionHeader,
  mainEntries: readonly SessionEntry[],
  appended: Array<{ header: { id: string; name?: string }; entries: readonly SessionEntry[] }>,
): string[] {
  const lines: string[] = [JSON.stringify(mainHeader)];
  let lastId: string | null = null;
  for (const entry of mainEntries) {
    lines.push(JSON.stringify(entry));
    lastId = entry.id;
  }

  for (const { header, entries } of appended) {
    if (entries.length === 0) continue;
    const { entries: remapped, rootId } = remapIds(entries);
    const markerId = randomUUID().slice(0, 8);
    const sourceTitle = header.name ?? header.id.slice(0, 8);
    lines.push(JSON.stringify({
      type: "custom_message",
      id: markerId,
      parentId: lastId,
      timestamp: new Date().toISOString(),
      customType: "pi-web:session-merge-marker",
      content: `Merged from session ${sourceTitle}`,
      display: true,
    } satisfies SessionEntry));
    for (const entry of remapped) {
      const next = entry.id === rootId
        ? { ...entry, parentId: markerId }
        : entry;
      lines.push(JSON.stringify(next));
      lastId = entry.id;
    }
  }
  return lines;
}

export interface SessionMergeResult {
  sessionId: string;
  path: string;
  preview: SessionMergePreview;
  /** The source session ids that were deleted by the merge. */
  deletedIds: string[];
}

/**
 * Merge the given sessions (ids[0] is the main line) into a new session file
 * beside the main session, then delete the sources. Re-parents each source's
 * direct forks/subagents onto the merged file, like delete does for its
 * siblings, so no orphaned parentSession links remain.
 */
export async function mergeSessions(ids: string[], force = false, sameCwdOnly = true): Promise<SessionMergeResult> {
  if (ids.length < 2) throw new SessionMergeError("too_few", "Select at least two sessions to merge.");
  const preview = await previewSessionMerge(ids);
  if (preview.hasSubagent) {
    throw new SessionMergeError("subagent", "A subagent session cannot be merged.");
  }
  if (sameCwdOnly && !preview.sameDirectory) {
    throw new SessionMergeError("cross_cwd", "These sessions are in different directories; turn off same-directory merging to combine them.");
  }
  if (!force && !preview.suggested) {
    throw new SessionMergeError("not_similar", "These sessions do not look similar; confirm to merge anyway.");
  }

  const paths = await Promise.all(ids.map(async (id) => {
    const path = await resolveSessionPath(id);
    if (!path || !existsSync(path)) throw new SessionMergeError("not_found", `Session not found: ${id}`);
    return path;
  }));

  const mainPath = paths[0];
  const mainDir = dirname(mainPath);
  const manager = SessionManager.open(mainPath);
  const mainHeader = manager.getHeader();
  if (!mainHeader) throw new SessionMergeError("unsaved", "The main session has no saved header.");
  const mainEntries = manager.getEntries() as unknown as SessionEntry[];

  const appended = await Promise.all(paths.slice(1).map(async (path, index) => {
    const sm = SessionManager.open(path);
    const header = sm.getHeader();
    const entries = sm.getEntries() as unknown as SessionEntry[];
    if (!header) throw new SessionMergeError("unsaved", `Session ${ids[index + 1]} has no saved header.`);
    const name = sm.getSessionName();
    return { header: { id: header.id, ...(name ? { name } : {}) }, entries };
  }));

  // A transaction-like write: create the new file (exclusive), then delete
  // the sources only once it exists.
  const sessionId = uuidv7();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const newPath = join(mainDir, `${fileTimestamp}_${sessionId}.jsonl`);
  const newHeader: SessionHeader = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp,
    cwd: mainHeader.cwd,
  };
  const lines = mergedFileLines(newHeader, mainEntries, appended);
  writeFileSync(newPath, lines.join("\n") + "\n", { encoding: "utf8", flag: "wx" });

  try {
    for (const sourcePath of paths) {
      const sourceId = SessionManager.open(sourcePath).getSessionId();
      reparentChildren(sourcePath, newPath);
      unlinkSync(sourcePath);
      invalidateSessionPathCache(sourceId);
    }
  } catch (error) {
    // Best effort: keep the merged file; a failed removal leaves the source
    // intact rather than losing data.
    void error;
  }
  invalidateSessionListCache();
  cacheSessionPath(sessionId, newPath);
  return { sessionId, path: newPath, preview, deletedIds: ids };
}

/** Point every session whose header.parentSession is `sourcePath` at `targetPath`. */
function reparentChildren(sourcePath: string, targetPath: string): void {
  const dir = dirname(sourcePath);
  const sourceKey = sessionPathKey(sourcePath);
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return;
  }
  for (const file of files) {
    const childPath = join(dir, file);
    if (sessionPathKey(childPath) === sourceKey) continue;
    try {
      const content = readFileSync(childPath, "utf8");
      const lines = content.split("\n");
      const header = JSON.parse(lines[0]) as SessionHeader;
      if (header.type !== "session" || !header.parentSession) continue;
      if (sessionPathKey(header.parentSession) !== sourceKey) continue;
      header.parentSession = targetPath;
      lines[0] = JSON.stringify(header);
      writeFileSync(childPath, lines.join("\n"), { encoding: "utf8" });
    } catch {
      // skip malformed or concurrently removed
    }
  }
}

