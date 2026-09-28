import {
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, type Dirent, fstatSync, openSync, readSync, statSync } from "fs";
import { readdir } from "fs/promises";
import { isAbsolute, join, normalize as normalizePath, relative, resolve as resolvePath, sep } from "path";
import type { AgentMessage, ImageContent, SessionEntry, SessionHeader, SessionInfo, SessionContext, SubagentSessionStatus } from "./types";
import { normalizeToolCalls } from "./normalize";
import { getThinkingPreview } from "./message-display";
import { projectIdentityKey } from "./project-identity";
import { sessionPathKey } from "./session-path";
import { MAX_TOOL_RESULT_IMAGE_BYTES, TOOL_RESULT_IMAGE_MIMES } from "./tool-result-images";
import { resolveProject, type ProjectInfo } from "./worktree";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import { listSessionsIncremental, NO_MESSAGES_PLACEHOLDER, type ScannedSessionInfo } from "./session-list-scanner";
import { readAsyncRunStatuses, type PiSubagentRun, type PiSubagentRunStep } from "./pi-subagents-runs";
import { mapPiSubagentRunState } from "./pi-subagents-snapshot";
import { hasActiveSessionLivenessProvider } from "./session-liveness";

export { getAgentDir };

const SESSION_HEADER_MAX_BYTES = 64 * 1024;
const SESSION_RELATION_MAX_BYTES = 256 * 1024;
const SESSION_RELATION_MAX_LINES = 2;
const SESSION_RESULT_MAX_BYTES = 256 * 1024;
// Bounded probe for the newest entry id; never reads a whole session file.
const SESSION_TAIL_PROBE_MAX_BYTES = 64 * 1024;

function readBoundedLines(filePath: string, maxBytes: number, maxLines: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    let newlineCount = 0;
    let reachedEof = false;

    while (position < maxBytes && newlineCount < maxLines) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        reachedEof = true;
        break;
      }
      position += bytesRead;
      const data = buffer.subarray(0, bytesRead);
      let end = data.length;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] !== 0x0a) continue;
        newlineCount += 1;
        if (newlineCount === maxLines) {
          end = index + 1;
          break;
        }
      }
      chunks.push(data.subarray(0, end));
    }

    const source = Buffer.concat(chunks).toString("utf8");
    const lines = source.split("\n");
    if (!reachedEof && !source.endsWith("\n")) lines.pop();
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function readBoundedTailLines(filePath: string, maxBytes: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const fileSize = fstatSync(fd).size;
    const start = Math.max(0, fileSize - maxBytes);
    const buffer = Buffer.allocUnsafe(fileSize - start);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    if (bytesRead === 0) return [];

    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start > 0) {
      const previousByte = Buffer.allocUnsafe(1);
      readSync(fd, previousByte, 0, 1, start - 1);
      if (previousByte[0] !== 0x0a) lines.shift();
    }
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function parseSessionEntries(lines: readonly string[]): SessionEntry[] {
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as SessionEntry;
      return [entry];
    } catch {
      return [];
    }
  });
}

/**
 * Entry id carried by one serialized JSONL line, or undefined when the line is
 * the session header, malformed, or a torn trailing write mid-append.
 *
 * The header carries the session id rather than an entry id, and the SDK's entry
 * index excludes it — treating it as an entry would evict a fresh wrapper.
 */
function readEntryId(line: string): string | undefined {
  try {
    const entry = JSON.parse(line) as { type?: unknown; id?: unknown };
    if (entry.type === "session") return undefined;
    return typeof entry.id === "string" && entry.id ? entry.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Newest entry id recorded on disk, read from a bounded tail so large sessions
 * stay cheap. Undefined when the file is absent (a wrapper that has not flushed
 * its first assistant turn yet) or unreadable.
 *
 * Used only on ?force=1 session reads (mount / page refresh). An id the
 * in-memory wrapper never saw means another pi process appended to the file.
 */
export function readLatestSessionEntryId(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  let lines: string[];
  try {
    lines = readBoundedTailLines(filePath, SESSION_TAIL_PROBE_MAX_BYTES);
  } catch {
    return undefined;
  }
  // Walk backwards so a torn trailing line falls back to the previous entry.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const entryId = readEntryId(lines[index]);
    if (entryId) return entryId;
  }
  return undefined;
}

function readSessionRelationEntries(filePath: string): SessionEntry[] {
  const prefixEntries = parseSessionEntries(
    readBoundedLines(filePath, SESSION_RELATION_MAX_BYTES, SESSION_RELATION_MAX_LINES).slice(1),
  );
  const isSubagent = prefixEntries.some((entry) => (
    entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE
  ));
  if (!isSubagent) return prefixEntries;

  return [
    ...prefixEntries,
    ...parseSessionEntries(readBoundedTailLines(filePath, SESSION_RESULT_MAX_BYTES)),
  ];
}

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    const projectRoot = project?.projectRoot ?? session.cwd;
    return {
      ...session,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
      ...(project?.branch ? { branch: project.branch } : {}),
      ...(project?.isWorktree ? { isWorktree: true } : {}),
    };
  });
}

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

type ScannedSubagent = NonNullable<ReturnType<typeof readSubagentRun>>;

// A pi-subagents child transcript keeps accumulating while its run is live. A
// foreground run leaves no `status.json`, so this freshness window plus a live
// parent session is the only signal that such a child is still running.
const PI_SUBAGENT_LIVE_CHILD_WINDOW_MS = 2 * 60 * 1000;
const PI_SUBAGENT_DESCRIPTION_MAX_CHARS = 120;

interface PiSubagentChildLayout {
  /** Basename of the parent session file, which is the containing directory's name. */
  parentBase: string;
  parentPath: string;
  /** `async-<runId>` directory segment, when the child ran detached. */
  runId?: string;
}

/**
 * Recognize the pi-subagents child layout under `<projectDir>/<parentBase>/`:
 * `<childUuid>/run-<N>/session.jsonl` and `<childUuid>/async-<runId>/session.jsonl`.
 * Only that exact filename nests, so artifact transcripts are never mistaken
 * for sessions.
 */
function piSubagentChildLayout(filePath: string): PiSubagentChildLayout | null {
  const sessionsDir = resolvePath(defaultSessionsDir());
  const relativePath = relative(sessionsDir, resolvePath(filePath));
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }
  const segments = relativePath.split(sep);
  // <projectDir>/<parentBase>/<childDir>/.../session.jsonl — at least 4 segments.
  if (segments.length < 4 || segments.at(-1) !== "session.jsonl") return null;
  const [projectDir, parentBase] = segments;
  const asyncSegment = segments.slice(2).find((segment) => segment.startsWith("async-"));
  return {
    parentBase,
    parentPath: join(sessionsDir, projectDir, `${parentBase}.jsonl`),
    ...(asyncSegment ? { runId: asyncSegment.slice("async-".length) } : {}),
  };
}

/**
 * Directory holding one top-level session's pi-subagents children:
 * `<sessionsDir>/<project>/<parentBase>/`. Null for nested child transcripts or
 * any path outside the default sessions directory.
 */
export function piSubagentChildRootDir(filePath: string): string | null {
  const sessionsDir = resolvePath(defaultSessionsDir());
  const candidate = resolvePathWithinDefaultSessions(filePath, sessionsDir);
  if (!candidate) return null;
  const segments = relative(sessionsDir, candidate).split(sep);
  if (segments.length !== 2 || !segments[1].endsWith(".jsonl")) return null;
  return join(sessionsDir, segments[0], segments[1].slice(0, -".jsonl".length));
}

/** True when the path is a nested child transcript rather than a top-level session. */
export function isPiSubagentChildSessionPath(filePath: string): boolean {
  return piSubagentChildLayout(filePath) !== null;
}

/** `subagent-<agent>-<uuid>-<n>` and `<agent>: <task>` are pi-subagents' names. */
function profileFromSessionName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  const prefixed = /^subagent-(.*)-[0-9a-f]{8}-[0-9a-f-]{27,}-\d+$/i.exec(trimmed);
  if (prefixed) return prefixed[1];
  const label = /^([A-Za-z0-9._-]+)\s*:/.exec(trimmed);
  return label ? label[1] : undefined;
}

// The marker lives inside a JSON-encoded `sections.preamble` string, so the
// quotes around the name are backslash-escaped in the raw line.
const ACTIVE_AGENT_MARKER = /<active_agent name=\\?"([^"\\]+)\\?"/;

/** Last-resort profile source: the `<active_agent name="..."/>` prompt marker. */
function profileFromActiveAgentMarker(filePath: string): string | undefined {
  try {
    const prefix = readBoundedLines(filePath, SESSION_RELATION_MAX_BYTES, 8).join("\n");
    return ACTIVE_AGENT_MARKER.exec(prefix)?.[1];
  } catch {
    return undefined;
  }
}

function excerpt(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > PI_SUBAGENT_DESCRIPTION_MAX_CHARS
    ? `${single.slice(0, PI_SUBAGENT_DESCRIPTION_MAX_CHARS - 1)}…`
    : single;
}

interface PiSubagentRelationContext {
  /** Child transcript path → the async run (and step) that produced it. */
  runByChildPath: Map<string, { run: PiSubagentRun; step: PiSubagentRunStep; stepIndex: number }>;
}

const EMPTY_PI_SUBAGENT_CONTEXT: PiSubagentRelationContext = { runByChildPath: new Map() };

function buildPiSubagentRelationContext(): PiSubagentRelationContext {
  const runs = readAsyncRunStatuses();
  const materialized = new Set(
    runs.flatMap((run) => run.steps.flatMap((step) => step.runId ? [step.runId] : [])),
  );
  const runByChildPath = new Map<string, { run: PiSubagentRun; step: PiSubagentRunStep; stepIndex: number }>();
  for (const run of runs) {
    // A workflow's child run writes the same transcript as the workflow step that
    // spawned it. The step owns the node id the panel joins on, so let the outer
    // workflow win; the transcript is identical either way.
    if (materialized.has(run.runId)) continue;
    for (const [stepIndex, step] of run.steps.entries()) {
      if (!step.sessionFile) continue;
      runByChildPath.set(sessionPathKey(step.sessionFile), { run, step, stepIndex });
    }
  }
  return { runByChildPath };
}

/**
 * Parent session id for a pi-subagents child. Orphaned children (parent deleted
 * or not scanned) must not be promoted to top-level rows with a misleading
 * inherited name, so the relation keeps a dangling parent id — exactly like a
 * legacy orphan whose `parentSessionId` no longer resolves.
 */
function resolvePiSubagentParent(
  layout: PiSubagentChildLayout,
  pathToId: Map<string, string>,
): string {
  const parentSessionId = pathToId.get(sessionPathKey(layout.parentPath));
  if (parentSessionId) return parentSessionId;
  // Session files are `<timestamp>_<uuid>.jsonl`, so the basename still carries
  // the parent's id even when its file is gone.
  const separator = layout.parentBase.lastIndexOf("_");
  return separator === -1 ? layout.parentBase : layout.parentBase.slice(separator + 1);
}

/**
 * Derive a `subagent` relation for a child transcript from the pi-subagents
 * directory layout. Async runs join their `status.json` for live state;
 * foreground children have no status file and read as completed unless their
 * parent session is still live and the transcript was just written.
 */
function derivePiSubagentRelation(
  scanned: ScannedSessionInfo,
  pathToId: Map<string, string>,
  context: PiSubagentRelationContext,
): SessionInfo["relation"] | undefined {
  const layout = piSubagentChildLayout(scanned.path);
  if (!layout) return undefined;
  const parentSessionId = resolvePiSubagentParent(layout, pathToId);

  const matched = context.runByChildPath.get(sessionPathKey(scanned.path));
  const profile = matched?.step.agent
    ?? profileFromSessionName(scanned.name)
    ?? profileFromActiveAgentMarker(scanned.path)
    ?? "subagent";
  // The scan's placeholder is not a description; let an absent first message
  // fall through to the profile at the return below.
  const firstMessage = scanned.firstMessage === NO_MESSAGES_PLACEHOLDER ? "" : scanned.firstMessage;
  const description = matched?.step.sessionName
    ?? matched?.step.description
    ?? excerpt(firstMessage);

  let status: SubagentSessionStatus = "completed";
  if (matched) {
    // A multi-step chain shares one status.json across several child
    // transcripts; the run aggregate would badge every step identically, so
    // each child takes its own step's state.
    status = mapPiSubagentRunState(matched.step.status);
  } else if (
    Date.now() - scanned.modified.getTime() < PI_SUBAGENT_LIVE_CHILD_WINDOW_MS
    && hasActiveSessionLivenessProvider({ sessionId: parentSessionId, sessionFile: layout.parentPath })
  ) {
    status = "running";
  }

  return {
    kind: "subagent",
    parentSessionId,
    parentSessionPath: layout.parentPath,
    profile,
    description: description || profile,
    status,
    engine: "pi-subagents",
    ...(matched ? { runId: matched.run.runId } : layout.runId ? { runId: layout.runId } : {}),
    // The snapshot node id for this child's step: a workflow lane key, a
    // materialized nested run id, or the scoped `step:<n>` fallback.
    ...(matched
      ? { stepRunId: matched.step.workflowKey ?? matched.step.runId ?? `step:${matched.stepIndex}` }
      : {}),
  };
}

function resolveScannedSessionRelation(
  scanned: ScannedSessionInfo,
  pathToId: Map<string, string>,
): { originSessionId?: string; subagent: ScannedSubagent | null } {
  const originSessionId = scanned.parentSessionPath
    ? pathToId.get(sessionPathKey(scanned.parentSessionPath))
    : undefined;
  if (!scanned.parentSessionPath) return { originSessionId, subagent: null };

  try {
    const subagent = readSubagentRun(readSessionRelationEntries(scanned.path), scanned.id, scanned.path);
    return { originSessionId, subagent };
  } catch {
    // Malformed or concurrently removed session.
    return { originSessionId, subagent: null };
  }
}

function mapScannedSession(
  scanned: ScannedSessionInfo,
  pathToId: Map<string, string>,
  context: PiSubagentRelationContext,
): SessionInfo {
  cacheSessionPath(scanned.id, scanned.path);
  const { originSessionId, subagent } = resolveScannedSessionRelation(scanned, pathToId);
  const detailsPending = scanned.detailsPending === true;
  const relation = subagent
    ? {
        kind: "subagent" as const,
        parentSessionId: subagent.parentSessionId,
        profile: subagent.profile,
        description: subagent.description,
        status: subagent.status,
      }
    : scanned.parentSessionPath
      ? { kind: "fork" as const, ...(originSessionId ? { originSessionId } : {}) }
      : derivePiSubagentRelation(scanned, pathToId, context);
  return {
    path: scanned.path,
    id: scanned.id,
    cwd: scanned.cwd,
    name: scanned.name,
    created: scanned.created.toISOString(),
    modified: scanned.modified.toISOString(),
    messageCount: scanned.messageCount,
    // A pending row has no first message yet; the placeholder would read as a
    // real "(no messages)" session until the details arrive.
    firstMessage: detailsPending && !scanned.firstMessage
      ? ""
      : scanned.firstMessage || NO_MESSAGES_PLACEHOLDER,
    parentSessionId: originSessionId ?? (relation?.kind === "subagent" ? relation.parentSessionId : undefined),
    ...(relation ? { relation } : {}),
    transient: false,
    ...(detailsPending ? { detailsPending: true } : {}),
  };
}

async function buildSessionList(scanned: ScannedSessionInfo[]): Promise<SessionInfo[]> {
  const pathToId = new Map<string, string>();
  for (const session of scanned) pathToId.set(sessionPathKey(session.path), session.id);
  // Run status files are only worth reading when at least one child transcript
  // is present; the common no-pi-subagents catalogue skips the scan entirely.
  const hasNestedChild = scanned.some((session) => piSubagentChildLayout(session.path) !== null);
  const context = hasNestedChild ? buildPiSubagentRelationContext() : EMPTY_PI_SUBAGENT_CONTEXT;
  return attachSessionProjectInfo(scanned.map((session) => mapScannedSession(session, pathToId, context)));
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  return buildSessionList(await listSessionsIncremental());
}

/**
 * Return a cheap catalogue for the first paint. Changed files contribute only
 * header/stat metadata; a normal listAllSessions() call hydrates the exact
 * counts, names, and first messages afterwards.
 */
export async function listSessionSummaries(): Promise<SessionInfo[]> {
  return buildSessionList(await listSessionsIncremental({ deferDetails: true }));
}

export async function listAllSessions(options: { force?: boolean; allowStale?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  const cache = globalThis.__piSessionListCache;
  if (cache && cache.generation === generation && Date.now() - cache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return cache.data;
  }

  // Callers that only need session metadata — mapping search hits onto sidebar
  // rows, for example — can take the previous scan and let the rebuild happen in
  // the background. A rebuild costs hundreds of milliseconds because it re-reads
  // every forked and subagent session, and it is triggered by ordinary agent
  // activity rather than by anything the caller did.
  if (options.allowStale && cache) {
    void listAllSessions().catch(() => undefined);
    return cache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    globalThis.__piSessionListCache = { data, ts: Date.now(), generation };
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number; generation: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function defaultSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

function resolvePathWithinDefaultSessions(
  filePath: string,
  sessionsDir = resolvePath(defaultSessionsDir()),
): string | null {
  const candidatePath = resolvePath(filePath);
  const relativePath = relative(sessionsDir, candidatePath);
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
    ? candidatePath
    : null;
}

async function findSessionPathById(sessionId: string): Promise<string | null> {
  // The filename is only a candidate hint; the bounded header check remains
  // authoritative so future layouts and malformed files use the full fallback.
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  let projectDirs: Dirent[];
  const sessionsDir = resolvePath(defaultSessionsDir());
  try {
    projectDirs = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const suffix = `_${sessionId}.jsonl`;
  let match: string | undefined;
  const consider = (candidate: string): boolean => {
    try {
      if (readSessionHeader(candidate)?.id !== sessionId) return false;
    } catch {
      return false;
    }
    // Do not choose between duplicate candidates; retain the existing
    // catalogue fallback for its current resolution semantics.
    if (match && match !== candidate) return true;
    match = candidate;
    return false;
  };

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory() && !projectDir.isSymbolicLink()) continue;
    const projectPath = resolvePathWithinDefaultSessions(
      join(sessionsDir, projectDir.name),
      sessionsDir,
    );
    if (!projectPath) continue;

    let files: string[];
    try {
      files = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const candidate = resolvePathWithinDefaultSessions(
        join(projectPath, file),
        sessionsDir,
      );
      if (!candidate) continue;
      if (consider(candidate)) return null;
    }
  }
  if (match) return match;

  // pi-subagents children nest as `<parentBase>/<childUuid>/run-<N>/session.jsonl`
  // and never carry the id in their filename, so a cold-server deep link needs
  // a recursive walk of each project directory to resolve without the full
  // catalogue scan.
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory() && !projectDir.isSymbolicLink()) continue;
    const projectPath = resolvePathWithinDefaultSessions(
      join(sessionsDir, projectDir.name),
      sessionsDir,
    );
    if (!projectPath) continue;

    let files: string[];
    try {
      files = await readdir(projectPath, { recursive: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith("session.jsonl")) continue;
      const candidate = resolvePathWithinDefaultSessions(join(projectPath, file), sessionsDir);
      if (!candidate) continue;
      if (consider(candidate)) return null;
    }
  }

  return match ?? null;
}

function findSessionIdByPath(filePath: string): string | undefined {
  if (!filePath.endsWith(".jsonl")) return undefined;
  const candidate = resolvePathWithinDefaultSessions(filePath);
  if (!candidate) return undefined;
  try {
    const sessionId = readSessionHeader(candidate)?.id;
    if (!sessionId) return undefined;
    cacheSessionPath(sessionId, candidate);
    return sessionId;
  } catch {
    return undefined;
  }
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  // The previous scan is kept, not discarded: it is no longer fresh, but it is
  // still a complete catalogue apart from sessions created moments ago. Callers
  // that pass `allowStale` read it instead of paying for a rebuild.
}

export function getSessionListVersion(): number {
  return globalThis.__piSessionListGeneration ?? 0;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

// ---------------------------------------------------------------------------
// Read-only SessionManager cache.
//
// Opening a large session (SessionManager.open -> full JSONL parse + index
// build) costs 150ms for a small session and ~1.1s for an 82MB one. Detail/
// context/pagination routes re-open the same file on every request whenever no
// live runtime wrapper exists, so a fingerprint-validated cache turns repeat
// opens into ~1ms map hits.
//
// Budget: a count cap alone is not enough. Parsed entries retain roughly the
// file's own size in heap (measured: an 82MB session holds ~94MB), so twelve
// large sessions would pin ~1.1GB. Entries are therefore also capped by the
// summed on-disk size of the cached files, and a single session larger than
// SM_CACHE_LIMITS.maxFileBytes is served fresh instead of being cached — one
// oversize session must not evict every useful entry.
//
// Safety: cached managers are READ-ONLY views. Any write path must go through
// a live wrapper or SessionManager.open directly — call openSessionManager
// with { mutable: true } (bypasses the cache) for those. The fingerprint
// (size + mtimeMs) invalidates on external appends (TUI writes), and
// invalidateSessionManagerCache(filePath) is called on delete/rename.
// ---------------------------------------------------------------------------

interface SmCacheEntry {
  sm: unknown;
  fingerprint: string;
  /** On-disk size, the proxy for this entry's retained heap. */
  bytes: number;
}

declare global {
  var __piSmCache: Map<string, SmCacheEntry> | undefined;
}

/**
 * Cache budget. Exported so tests can shrink it to values they can actually
 * produce on disk; production never reassigns these.
 */
export const SM_CACHE_LIMITS = {
  /** Most sessions held at once. */
  maxEntries: 12,
  /** Summed on-disk size of cached sessions. */
  maxTotalBytes: 256 * 1024 * 1024,
  /** A session larger than this is never cached — it would evict everything else. */
  maxFileBytes: 64 * 1024 * 1024,
};

function getSmCache(): Map<string, SmCacheEntry> {
  if (!globalThis.__piSmCache) globalThis.__piSmCache = new Map();
  return globalThis.__piSmCache;
}

function sessionFileStats(filePath: string): { fingerprint: string; bytes: number } | null {
  try {
    const stats = statSync(filePath);
    return { fingerprint: `${stats.size}:${stats.mtimeMs}`, bytes: stats.size };
  } catch {
    return null;
  }
}

/** Evict least-recently-used entries until both the count and byte caps hold. */
function evictSmCache(cache: Map<string, SmCacheEntry>): void {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  while (cache.size > SM_CACHE_LIMITS.maxEntries || total > SM_CACHE_LIMITS.maxTotalBytes) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    total -= cache.get(oldestKey)?.bytes ?? 0;
    cache.delete(oldestKey);
  }
}

export function invalidateSessionManagerCache(filePath?: string): void {
  const cache = getSmCache();
  if (filePath === undefined) {
    cache.clear();
    return;
  }
  cache.delete(sessionPathKey(filePath));
}

/**
 * Open a session file, reusing a cached read-only SessionManager when the
 * on-disk fingerprint is unchanged. Pass { mutable: true } when the caller
 * intends to append/branch/rewrite — that path always opens fresh.
 */
export function openSessionManager(
  filePath: string,
  options: { mutable?: boolean } = {},
): SessionManager {
  if (options.mutable) return SessionManager.open(filePath, undefined);

  const cache = getSmCache();
  const pathKey = sessionPathKey(filePath);
  const stats = sessionFileStats(filePath);
  if (stats === null) {
    cache.delete(pathKey);
    return SessionManager.open(filePath, undefined);
  }

  const cached = cache.get(pathKey);
  if (cached && cached.fingerprint === stats.fingerprint) {
    // LRU touch.
    cache.delete(pathKey);
    cache.set(pathKey, cached);
    return cached.sm as SessionManager;
  }

  const sm = SessionManager.open(filePath, undefined);
  if (stats.bytes > SM_CACHE_LIMITS.maxFileBytes) {
    // Too large to hold: drop any stale entry for this path and serve fresh.
    cache.delete(pathKey);
    return sm;
  }
  cache.set(pathKey, { sm, fingerprint: stats.fingerprint, bytes: stats.bytes });
  evictSmCache(cache);
  return sm;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  const targetedPath = await findSessionPathById(sessionId);
  if (targetedPath) {
    cacheSessionPath(sessionId, targetedPath);
    return getPathCache().get(sessionId) ?? null;
  }

  // Unknown layouts, malformed candidates, and duplicate IDs retain the
  // existing authoritative catalogue scan instead of negative-caching a miss.
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  const targetedId = findSessionIdByPath(filePath);
  if (targetedId) return targetedId;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const firstLine = readBoundedLines(filePath, SESSION_HEADER_MAX_BYTES, 1)[0]?.trimEnd();
  if (!firstLine) return null;
  try {
    const header = JSON.parse(firstLine) as SessionHeader;
    return header.type === "session" ? header : null;
  } catch {
    return null;
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = openSessionManager(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function getLatestModelChange(entries: SessionEntry[]): SessionContext["model"] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "model_change") {
      return { provider: entry.provider, modelId: entry.modelId };
    }
  }
  return null;
}

function getSessionSettings(entries: SessionEntry[], leafId?: string | null): Pick<SessionContext, "thinkingLevel" | "model"> {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const branch = sliceActiveBranch(entries, leafId ?? null, entries.length);
  let thinkingLevel: string | undefined;
  let responseModel: SessionContext["model"] | undefined;

  for (let i = branch.length - 1; i >= 0 && (thinkingLevel === undefined || responseModel === undefined); i--) {
    const entry = branch[i];
    if (thinkingLevel === undefined && entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    }
    if (responseModel === undefined && entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as { provider?: unknown; model?: unknown };
      if (typeof message.provider === "string" && typeof message.model === "string") {
        responseModel = { provider: message.provider, modelId: message.model };
      }
    }
  }

  return {
    thinkingLevel: thinkingLevel ?? "off",
    model: getLatestModelChange(branch) ?? responseModel ?? null,
  };
}

export interface BuildSessionContextOptions {
  deferThinking?: boolean;
  deferToolResultImages?: boolean;
  tail?: number;
  excludeLeaf?: boolean;
  /** Session id used to build lazy URLs for historical tool-result images. */
  sessionId?: string;
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: BuildSessionContextOptions = {},
): SessionContext {
  const { tail, excludeLeaf } = options;
  // History pages retain the original branch order, including compacted messages.
  // SDK context filtering can drop a page's messages when firstKeptEntryId is outside it.
  const sliced = leafId === null ? [] : sliceActiveBranch(
    entries, leafId ?? null, tail && tail > 0 ? tail : entries.length, excludeLeaf,
  );
  const hasMore = Boolean(tail && tail > 0 && sliced[0]?.parentId);

  // Convert messages and their IDs together to keep fork/navigation targets aligned.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of sliced) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }

  return {
    messages,
    entryIds,
    oldestEntryId: sliced[0]?.id ?? null,
    hasMore,
    ...getSessionSettings(entries, leafId),
  };
}

/**
 * Entry that renders as a standalone visible message in the chat window:
 * user / assistant messages plus the compaction divider. toolResult entries,
 * hidden custom messages and session meta render as attachments or nothing,
 * so they must not consume the `tail` budget — counting raw entries starves
 * user messages out of the window in agent-heavy sessions (a 50-entry window
 * over a tool-heavy session can hold a single user message).
 */
function countsTowardTail(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return true;
  if (entry.type !== "message") return false;
  const role = (entry as { message?: { role?: string } }).message?.role;
  return role === "user" || role === "assistant";
}

/**
 * Raw-entry ceiling for one page, so a span of tool traffic with few visible
 * anchors cannot balloon the payload. Scaled with `tail`; older history still
 * pages in via `before`.
 */
const MIN_RAW_WINDOW_ENTRIES = 200;
const rawWindowCap = (tail: number) => Math.max(MIN_RAW_WINDOW_ENTRIES, tail * 6);

/**
 * Extract the ancestor chain from `leafId` back toward the root, capped at
 * `tail` visible entries (most-recent first after the final reverse).
 * Iterative: a linear session's chain length equals its entry count, so a
 * recursive walk would overflow the stack. The result is still a valid prefix
 * of the active branch — older history is loaded on demand via pagination.
 */
export function sliceActiveBranch(
  entries: SessionEntry[],
  leafId: string | null,
  tail: number,
  excludeLeaf = false,
): SessionEntry[] {
  if (tail <= 0) return entries;
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  // Pagination: `before` is the oldest entry already loaded, so the next page
  // must start at its parent to avoid duplicating `before` when prepended.
  if (excludeLeaf) leaf = leaf?.parentId ? byId.get(leaf.parentId) : undefined;
  if (!leaf) return [];
  const chain: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  let visible = 0;
  const rawCap = rawWindowCap(tail);
  while (current) {
    chain.push(current);
    if (countsTowardTail(current)) visible++;
    if (visible >= tail || chain.length >= rawCap) break;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  chain.reverse();
  return chain;
}
function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function deferToolResultBase64Images(
  message: AgentMessage,
  sessionId: string | undefined,
  entryId: string,
): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.flatMap((block, blockIndex) => {
    const image = base64ImageInfo(block);
    if (!image) return [block];

    // Keep the initial history response small, but preserve an image block that
    // the browser can load only when its collapsed tool result is expanded.
    if (
      sessionId &&
      image.mime &&
      TOOL_RESULT_IMAGE_MIMES.has(image.mime) &&
      image.bytes > 0 &&
      image.bytes <= MAX_TOOL_RESULT_IMAGE_BYTES
    ) {
      const source: ImageContent["source"] = {
        type: "url",
        media_type: image.mime,
        url: `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${blockIndex}`,
      };
      return [{ type: "image", source } satisfies ImageContent];
    }

    // Retain the old bounded fallback for callers that do not have a session id.
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return [];
  });
  if (omitted === 0) return { ...message, content };

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: BuildSessionContextOptions,
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      // Transcript system messages carry the prompt and tool loadout (Pi >= 0.86).
      // They are provider input, not conversation, so they never render.
      if (entry.message.role === "system") return null;
      let message = options.deferToolResultImages
        ? deferToolResultBase64Images(normalizeToolCalls(entry.message), options.sessionId, entry.id)
        : normalizeToolCalls(entry.message);
      const legacyContent = message.role === "assistant" ? (message as { content: unknown }).content : undefined;
      if (typeof legacyContent === "string") {
        message = { ...message, content: [{ type: "text", text: legacyContent }] } as AgentMessage;
      }
      if (!options.deferThinking || message.role !== "assistant") return message;
      const content = message.content;
      return {
        ...message,
        content: content.map((block) => (
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
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
