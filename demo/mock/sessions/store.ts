/**
 * In-memory session store: the demo's equivalent of ~/.pi/agent/sessions.
 * Sessions are expanded from the tutorial scripts on first use (in the UI
 * language) and then mutated by prompts, forks, renames and deletes.
 */
import type { AgentMessage, SessionContext, SessionEntry, SessionInfo } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { getThinkingPreview } from "@/lib/message-display";
import { computeSessionStats } from "@/lib/session-stats";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { projectTreeForResponse, toSummaryTree } from "@/lib/project-tree";
import { readSessionToolSelectionFromEntries } from "./tool-selection";
import { currentDemoLocale, type DemoLocale } from "../locale";
import { PROJECT_BRANCH, PROJECT_ROOT, SCRATCH_ROOT, WORKTREE_BRANCH, WORKTREE_ROOT, sessionFilePath } from "../paths";
import { buildSession } from "./builder";
import { SESSION_SCRIPTS } from "./scripts";

export interface LiveState {
  model: { provider: string; modelId: string };
  thinkingLevel: string;
  running: boolean;
  streamingMessage: AgentMessage | null;
  autoCompactionEnabled: boolean;
}

export interface MockSession {
  id: string;
  cwd: string;
  created: string;
  name?: string;
  relation?: SessionInfo["relation"];
  parentSessionId?: string;
  entries: SessionEntry[];
  leafId: string | null;
  /** Created by /api/agent/new and not yet written to "disk". */
  transient: boolean;
  live: LiveState | null;
}

const PAGE_LOADED_AT = Date.now();

const state: {
  sessions: Map<string, MockSession>;
  locale: DemoLocale | null;
  building: Promise<void> | null;
  /** True once the visitor changed anything; stops locale rebuilds. */
  touched: boolean;
  version: number;
} = { sessions: new Map(), locale: null, building: null, touched: false, version: 1 };

export function projectRootFor(cwd: string): string {
  if (cwd === SCRATCH_ROOT || cwd.startsWith(`${SCRATCH_ROOT}/`)) return SCRATCH_ROOT;
  return PROJECT_ROOT;
}

export function sessionListVersion(): number {
  return state.version;
}

export function bumpSessionListVersion(): void {
  state.version += 1;
}

export function markTouched(): void {
  state.touched = true;
}

async function build(locale: DemoLocale): Promise<void> {
  const sessions = new Map<string, MockSession>();
  for (const script of SESSION_SCRIPTS) {
    const built = await buildSession(script, locale, PAGE_LOADED_AT, projectRootFor);
    const created = new Date(PAGE_LOADED_AT - script.startedMinutesAgo * 60_000).toISOString();
    sessions.set(script.id, {
      id: script.id,
      cwd: script.cwd,
      created,
      name: script.name ? (typeof script.name === "string" ? script.name : script.name[locale]) : undefined,
      relation: script.relation,
      parentSessionId: script.parentSessionId,
      entries: built.entries,
      leafId: built.leafId,
      transient: false,
      live: null,
    });
  }
  state.sessions = sessions;
  state.locale = locale;
}

/** Build (or rebuild after a language switch) the tutorial sessions. */
export async function ensureSessions(): Promise<void> {
  const locale = currentDemoLocale();
  if (state.building) await state.building;
  if (state.locale === locale || (state.locale && state.touched)) return;
  const rebuilding = state.locale !== null;
  state.building = build(locale).finally(() => { state.building = null; });
  await state.building;
  if (rebuilding) state.version += 1;
}

export function allSessions(): MockSession[] {
  return [...state.sessions.values()];
}

export function getSession(id: string): MockSession | undefined {
  return state.sessions.get(id);
}

export function addSession(session: MockSession): void {
  state.sessions.set(session.id, session);
  state.touched = true;
  state.version += 1;
}

export function deleteSession(id: string): void {
  state.sessions.delete(id);
  // Subagents are removed with their parent, like the real DELETE route.
  for (const session of state.sessions.values()) {
    if (session.relation?.kind === "subagent" && session.relation.parentSessionId === id) {
      state.sessions.delete(session.id);
    }
  }
  state.touched = true;
  state.version += 1;
}

let entryCounter = 0x9000;
export function newEntryId(): string {
  entryCounter += 1;
  return `${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}${entryCounter.toString(16).padStart(4, "0")}`.slice(-8);
}

export function appendEntry(session: MockSession, entry: Record<string, unknown>): SessionEntry {
  const full = {
    ...entry,
    id: newEntryId(),
    parentId: session.leafId,
    timestamp: new Date().toISOString(),
  } as SessionEntry;
  session.entries.push(full);
  session.leafId = full.id;
  session.transient = false;
  state.touched = true;
  state.version += 1;
  return full;
}

export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((block: { type?: string }) => block?.type === "text") as { text?: string } | undefined;
    return text?.text ?? "";
  }
  return "";
}

function lastActivity(session: MockSession): string {
  let latest = Date.parse(session.created);
  for (const entry of session.entries) {
    const stamp = entry.type === "message"
      ? (entry.message as { timestamp?: number }).timestamp ?? Date.parse(entry.timestamp)
      : Date.parse(entry.timestamp);
    if (Number.isFinite(stamp) && stamp > latest) latest = stamp;
  }
  return new Date(latest).toISOString();
}

export function sessionInfo(session: MockSession): SessionInfo {
  const stats = computeSessionStats(session.entries);
  const firstUser = session.entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  const firstMessage = firstUser?.type === "message" ? messageText((firstUser.message as { content: unknown }).content) || "(no messages)" : "(no messages)";
  const projectRoot = projectRootFor(session.cwd);
  return {
    path: session.transient ? "" : sessionFilePath(session.cwd, session.created, session.id),
    id: session.id,
    cwd: session.cwd,
    ...(session.name ? { name: session.name } : {}),
    created: session.created,
    modified: lastActivity(session),
    messageCount: stats.totalMessages,
    firstMessage,
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.relation ? { relation: session.relation } : {}),
    transient: session.transient,
    projectRoot,
    projectKey: projectRoot,
    ...(session.cwd.startsWith(WORKTREE_ROOT)
      ? { branch: WORKTREE_BRANCH, isWorktree: true }
      : projectRoot === PROJECT_ROOT ? { branch: PROJECT_BRANCH } : {}),
  };
}

// ---------------------------------------------------------------------------
// Context building: a browser port of lib/session-reader.ts buildSessionContext.
// ---------------------------------------------------------------------------

interface ContextOptions {
  deferThinking?: boolean;
  tail?: number;
  excludeLeaf?: boolean;
}

function countsTowardTail(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return true;
  if (entry.type !== "message") return false;
  const role = entry.message.role;
  return role === "user" || role === "assistant";
}

function sliceActiveBranch(entries: SessionEntry[], leafId: string | null, tail: number, excludeLeaf = false): SessionEntry[] {
  if (tail <= 0) return entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  if (excludeLeaf) leaf = leaf?.parentId ? byId.get(leaf.parentId) : undefined;
  if (!leaf) return [];
  const chain: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  let visible = 0;
  const rawCap = Math.max(200, tail * 6);
  while (current) {
    chain.push(current);
    if (countsTowardTail(current)) visible++;
    if (visible >= tail || chain.length >= rawCap) break;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}

function entryToUiMessage(entry: SessionEntry, options: ContextOptions): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      if (entry.message.role === "system") return null;
      const message = normalizeToolCalls(entry.message as AgentMessage);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: getThinkingPreview(block.thinking), deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: { tokensBefore: entry.tokensBefore, firstKeptEntryId: entry.firstKeptEntryId },
        timestamp: Date.parse(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: Date.parse(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: Date.parse(entry.timestamp),
      };
    default:
      return null;
  }
}

function sessionSettings(entries: SessionEntry[], leafId: string | null): Pick<SessionContext, "thinkingLevel" | "model"> {
  const branch = sliceActiveBranch(entries, leafId, entries.length);
  let thinkingLevel: string | undefined;
  let changedModel: SessionContext["model"] | undefined;
  let responseModel: SessionContext["model"] | undefined;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (thinkingLevel === undefined && entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
    if (changedModel === undefined && entry.type === "model_change") changedModel = { provider: entry.provider, modelId: entry.modelId };
    if (responseModel === undefined && entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as { provider?: string; model?: string };
      if (message.provider && message.model) responseModel = { provider: message.provider, modelId: message.model };
    }
  }
  return { thinkingLevel: thinkingLevel ?? "off", model: changedModel ?? responseModel ?? null };
}

export function buildContext(session: MockSession, leafId: string | null | undefined, options: ContextOptions): SessionContext {
  const effectiveLeaf = leafId === undefined ? session.leafId : leafId;
  const tail = options.tail ?? 50;
  const sliced = sliceActiveBranch(session.entries, effectiveLeaf, tail, options.excludeLeaf);
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of sliced) {
    const message = entryToUiMessage(entry, options);
    if (message) {
      messages.push(message);
      entryIds.push(entry.id);
    }
  }
  return {
    messages,
    entryIds,
    oldestEntryId: sliced[0]?.id ?? null,
    hasMore: Boolean(tail > 0 && sliced[0]?.parentId),
    ...sessionSettings(session.entries, effectiveLeaf),
  };
}

interface TreeNode {
  entry: SessionEntry;
  children: TreeNode[];
  label?: string;
}

function sessionTree(entries: SessionEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const labels = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "label") {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
  }
  for (const entry of entries) nodes.set(entry.id, { entry, children: [], label: labels.get(entry.id) });
  const roots: TreeNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id)!;
    const parent = entry.parentId ? nodes.get(entry.parentId) : undefined;
    if (!entry.parentId || entry.parentId === entry.id || !parent) roots.push(node);
    else parent.children.push(node);
  }
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => Date.parse(a.entry.timestamp) - Date.parse(b.entry.timestamp));
    stack.push(...node.children);
  }
  return roots;
}

export function sessionDetail(session: MockSession, params: URLSearchParams) {
  const summaryTree = params.get("tree") === "summary";
  const projected = projectTreeForResponse(sessionTree(session.entries) as never[]);
  const tree = summaryTree ? toSummaryTree(projected) : projected;
  const rawTail = Number(params.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const context = buildContext(session, session.leafId, { deferThinking: params.has("deferThinking"), tail });
  const toolNames = readSessionToolSelectionFromEntries(session.entries);
  const latest = session.entries[session.entries.length - 1];
  return {
    sessionId: session.id,
    filePath: session.transient ? "" : sessionFilePath(session.cwd, session.created, session.id),
    info: sessionInfo(session),
    leafId: session.leafId,
    tree,
    ...(summaryTree ? { treeFormat: "summary" as const } : {}),
    snapshotRevision: `demo:${session.id}:${session.entries.length}:${latest?.id ?? "none"}:${session.leafId ?? "root"}`,
    context,
    stats: computeSessionStats(session.entries),
    totalActiveMs: computeSessionTotalActiveMs(session.entries),
    ...(toolNames !== undefined ? { toolNames } : {}),
  };
}
