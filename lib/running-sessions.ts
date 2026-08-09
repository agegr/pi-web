import type {
  RunningSessionSnapshot,
  RunningSessionStatus,
  RunningSessionStatusKind,
  SessionInfo,
} from "./types";

export interface RunningToolActivity {
  name: string;
  detail?: string;
}

export interface RunningStatusInput {
  isCompacting: boolean;
  isBashRunning: boolean;
  isStreaming: boolean;
  isPromptRunning: boolean;
  activeTools?: readonly RunningToolActivity[];
  bashCommand?: string | null;
}

/**
 * The status order is intentionally fixed: a more specific operation wins over
 * the generic streaming/processing state when more than one flag is true.
 */
export function resolveRunningStatus(input: RunningStatusInput): RunningSessionStatus {
  if (input.isCompacting) {
    return { kind: "compacting" };
  }

  const tools = input.activeTools ?? [];
  if (input.isBashRunning || tools.length > 0) {
    const detail = input.bashCommand || tools.map((tool) => tool.detail || tool.name).join(", ");
    return {
      kind: "executing",
      ...(detail ? { detail: truncateStatusDetail(detail) } : {}),
    };
  }

  if (input.isStreaming || input.isPromptRunning) {
    return { kind: "generating" };
  }

  return { kind: "processing" };
}

/** Keep command previews compact enough for a sidebar row. */
export function truncateStatusDetail(detail: string, maxLength = 180): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

const RUNNING_STATUS_KINDS: ReadonlySet<RunningSessionStatusKind> = new Set([
  "compacting",
  "executing",
  "generating",
  "processing",
  "unknown",
]);

function isRunningStatus(value: unknown): value is RunningSessionStatus {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && RUNNING_STATUS_KINDS.has(kind as RunningSessionStatusKind);
}

function unknownRunningSessionSnapshot(id: string, metadata?: SessionInfo): RunningSessionSnapshot {
  if (metadata) {
    return {
      id,
      path: metadata.path,
      title: metadata.name || metadata.firstMessage || id.slice(0, 12) || "unknown",
      cwd: metadata.cwd,
      projectRoot: metadata.projectRoot ?? metadata.cwd,
      ...(metadata.worktreeBranch ? { worktreeBranch: metadata.worktreeBranch } : {}),
      messageCount: metadata.messageCount,
      status: { kind: "unknown" },
      queued: 0,
      ...(metadata.cwdAvailable !== undefined ? { cwdAvailable: metadata.cwdAvailable } : {}),
    };
  }

  return {
    id,
    path: "",
    title: id.slice(0, 12) || "unknown",
    cwd: "",
    projectRoot: "",
    messageCount: 0,
    status: { kind: "unknown" },
    queued: 0,
  };
}

/**
 * Merge a possibly partial aggregate response with the last known rows.
 *
 * The running-id set is authoritative: rows missing from that set are
 * completed and must disappear. A row that remains running but has no status
 * in a partial response keeps its previous status; a brand-new row is explicit
 * about being unknown instead of pretending that it is processing.
 */
export function mergeRunningSessionSnapshots(
  previous: readonly RunningSessionSnapshot[],
  next: readonly (Pick<RunningSessionSnapshot, "id"> & Partial<Omit<RunningSessionSnapshot, "id">>)[],
  runningSessionIds: readonly string[] = next.map((session) => session.id),
  metadataById?: ReadonlyMap<string, SessionInfo>,
): RunningSessionSnapshot[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));
  const nextById = new Map(next.map((session) => [session.id, session]));
  const ids = [...new Set(runningSessionIds)];

  return ids.map((id) => {
    const previousSession = previousById.get(id);
    const incoming = nextById.get(id);
    const base = previousSession ?? unknownRunningSessionSnapshot(id, metadataById?.get(id));
    if (!incoming) {
      return {
        ...base,
        status: previousSession?.status ?? { kind: "unknown" },
      };
    }

    const status = isRunningStatus(incoming.status)
      ? incoming.status
      : previousSession?.status ?? { kind: "unknown" as const };
    return {
      ...base,
      ...incoming,
      id,
      path: typeof incoming.path === "string" ? incoming.path : base.path,
      title: typeof incoming.title === "string" ? incoming.title : base.title,
      cwd: typeof incoming.cwd === "string" ? incoming.cwd : base.cwd,
      projectRoot: typeof incoming.projectRoot === "string" ? incoming.projectRoot : base.projectRoot,
      messageCount: typeof incoming.messageCount === "number" ? incoming.messageCount : base.messageCount,
      status,
      queued: typeof incoming.queued === "number" ? incoming.queued : base.queued,
      ...(typeof incoming.cwdAvailable === "boolean"
        ? { cwdAvailable: incoming.cwdAvailable }
        : base.cwdAvailable !== undefined ? { cwdAvailable: base.cwdAvailable } : {}),
    };
  });
}

/**
 * Create a temporary history row as soon as a live session leaves the running
 * set. The next session-list refresh replaces it with authoritative metadata.
 */
export function runningSnapshotToSessionInfo(
  snapshot: RunningSessionSnapshot,
  modified = new Date().toISOString(),
): SessionInfo {
  return {
    path: snapshot.path,
    id: snapshot.id,
    cwd: snapshot.cwd,
    created: modified,
    modified,
    messageCount: snapshot.messageCount,
    firstMessage: snapshot.title || "(no messages)",
    ...(snapshot.projectRoot ? { projectRoot: snapshot.projectRoot } : {}),
    ...(snapshot.worktreeBranch ? { worktreeBranch: snapshot.worktreeBranch } : {}),
    ...(snapshot.cwdAvailable !== undefined ? { cwdAvailable: snapshot.cwdAvailable } : {}),
  };
}

/**
 * Turn a tool call into a useful one-line preview without exposing the whole
 * argument object in the navigation API.
 */
export function formatRunningToolDetail(name: string, args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return name;

  const record = args as Record<string, unknown>;
  const preferredKeys = ["command", "path", "file_path", "pattern", "query", "url"];
  const value = preferredKeys
    .map((key) => record[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);

  if (!value) return name;
  return `${name} ${truncateStatusDetail(value)}`;
}

/** Extract the visible text used as a session title fallback from a user message. */
export function getUserMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== "user") return undefined;
  if (typeof record.content === "string") return record.content.trim() || undefined;
  if (!Array.isArray(record.content)) return undefined;

  const text = record.content
    .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block && typeof block === "object"))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join(" ")
    .trim();
  return text || undefined;
}

export interface RunningSessionRuntimeSnapshot {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstMessage?: string;
  messageCount: number;
  status: RunningSessionStatus;
  queued: number;
  cwdAvailable?: boolean;
}

export interface RunningProjectInfo {
  projectRoot: string;
  branch?: string | null;
  isWorktree?: boolean;
  cwdAvailable?: boolean;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

/**
 * Merge live RPC data with the session-list metadata used by navigation. The
 * runtime snapshot is still sufficient when a new session has not flushed its
 * first file entry yet.
 */
export function buildRunningSessionSnapshot(
  runtime: RunningSessionRuntimeSnapshot,
  session: SessionInfo | undefined,
  project: RunningProjectInfo,
): RunningSessionSnapshot {
  const title = firstNonEmpty(
    session?.name,
    runtime.name,
    session?.firstMessage,
    runtime.firstMessage,
  ) ?? runtime.id.slice(0, 12);
  const projectRoot = session?.projectRoot ?? project.projectRoot ?? runtime.cwd;
  const worktreeBranch = session?.worktreeBranch
    ?? (project.isWorktree && project.branch ? project.branch : undefined);

  return {
    id: runtime.id,
    path: session?.path ?? runtime.path,
    title,
    cwd: runtime.cwd,
    projectRoot,
    ...(worktreeBranch ? { worktreeBranch } : {}),
    messageCount: session?.messageCount ?? runtime.messageCount,
    status: runtime.status,
    queued: runtime.queued,
    ...(session?.cwdAvailable !== undefined
      ? { cwdAvailable: session.cwdAvailable }
      : project.cwdAvailable !== undefined ? { cwdAvailable: project.cwdAvailable } : runtime.cwdAvailable !== undefined ? { cwdAvailable: runtime.cwdAvailable } : {}),
  };
}
