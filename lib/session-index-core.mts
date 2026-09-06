import { createReadStream } from "node:fs";
import type { BigIntStats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, normalize as normalizePath } from "node:path";

export interface SessionFileFingerprint {
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  dev: string;
  ino: string;
}

export interface IndexedSessionMetadata {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionPath?: string;
  subagent?: {
    parentSessionId: string;
    profile: string;
    description: string;
    status: "completed" | "failed" | "aborted" | "interrupted";
  };
}

export interface SessionIndexEntry {
  fingerprint: SessionFileFingerprint;
  metadata: IndexedSessionMetadata | null;
}

export interface SessionIndexReconcileResult {
  entries: Map<string, SessionIndexEntry>;
  parsed: number;
  reused: number;
  removed: number;
  unstable: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function textContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Invalid message content");
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
    .map((block) => typeof block.text === "string" ? block.text : "")
    .join(" ");
}

function messageActivityTime(entry: Record<string, unknown>, message: Record<string, unknown>): number | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number") return message.timestamp;
  if (typeof entry.timestamp !== "string") return undefined;
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function fingerprintFromStats(stats: BigIntStats): SessionFileFingerprint {
  return {
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
  };
}

export function equalSessionFingerprint(
  left: SessionFileFingerprint,
  right: SessionFileFingerprint,
): boolean {
  return left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.dev === right.dev
    && left.ino === right.ino;
}

async function statFingerprint(filePath: string): Promise<SessionFileFingerprint | null> {
  try {
    return fingerprintFromStats(await stat(filePath, { bigint: true }));
  } catch {
    return null;
  }
}

export async function parseIndexedSessionMetadata(
  filePath: string,
): Promise<IndexedSessionMetadata | null> {
  try {
    const fileStats = await stat(filePath);
    let header: Record<string, unknown> | null = null;
    let name: string | undefined;
    let messageCount = 0;
    let firstMessage = "";
    let lastActivityTime: number | undefined;
    let sawSubagentMetadata = false;
    let subagent: IndexedSessionMetadata["subagent"];
    let subagentStatus: NonNullable<IndexedSessionMetadata["subagent"]>["status"] = "interrupted";
    const lines = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      const entry = parseJsonLine(line);
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
      }
      // Project relation data while this changed file is already being read.
      // Match readSubagentRun: first metadata entry, latest result, no runtime inference.
      if (entry.type === "custom" && entry.customType === "pi-web:subagent" && !sawSubagentMetadata) {
        sawSubagentMetadata = true;
        const data = entry.data;
        if (isRecord(data) && data.version === 1
          && typeof data.parentSessionId === "string" && typeof data.parentSessionPath === "string") {
          subagent = {
            parentSessionId: data.parentSessionId,
            profile: typeof data.profile === "string" ? data.profile : "general-purpose",
            description: typeof data.description === "string" ? data.description : "Subagent",
            status: "interrupted",
          };
        }
      }
      if (entry.type === "custom" && entry.customType === "pi-web:subagent-result") {
        const data = entry.data;
        subagentStatus = isRecord(data)
          && (data.status === "completed" || data.status === "failed" || data.status === "aborted")
          ? data.status : "interrupted";
      }
      if (entry.type !== "message") continue;
      messageCount += 1;
      if (!isRecord(entry.message)) continue;
      const message = entry.message;
      const activityTime = messageActivityTime(entry, message);
      if (activityTime !== undefined) {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }
      if (message.role !== "user" && message.role !== "assistant") continue;
      const content = textContent(message);
      if (!content) continue;
      if (!firstMessage && message.role === "user") firstMessage = content;
    }

    if (!header || typeof header.id !== "string") return null;
    const headerTimestamp = typeof header.timestamp === "string" ? header.timestamp : "";
    const headerTime = Date.parse(headerTimestamp);
    const modified = lastActivityTime !== undefined && lastActivityTime > 0
      ? new Date(lastActivityTime)
      : !Number.isNaN(headerTime)
        ? new Date(headerTime)
        : fileStats.mtime;
    return {
      path: normalizePath(filePath),
      id: header.id,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      created: new Date(headerTimestamp).toISOString(),
      modified: modified.toISOString(),
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      ...(subagent ? { subagent: { ...subagent, status: subagentStatus } } : {}),
      ...(typeof header.parentSession === "string"
        ? { parentSessionPath: header.parentSession }
        : {}),
    };
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function parseStableEntry(
  filePath: string,
  initialFingerprint: SessionFileFingerprint,
): Promise<SessionIndexEntry | null> {
  let fingerprint = initialFingerprint;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const metadata = await parseIndexedSessionMetadata(filePath);
    const finalFingerprint = await statFingerprint(filePath);
    if (!finalFingerprint) return null;
    if (equalSessionFingerprint(fingerprint, finalFingerprint)) {
      return { fingerprint: finalFingerprint, metadata };
    }
    fingerprint = finalFingerprint;
  }
  return null;
}

export async function reconcileSessionFiles(
  filePaths: string[],
  previous: ReadonlyMap<string, SessionIndexEntry> = new Map(),
): Promise<SessionIndexReconcileResult> {
  const normalizedPaths = [...new Set(filePaths.map((filePath) => normalizePath(filePath)))];
  const fingerprints = await mapWithConcurrency(
    normalizedPaths,
    16,
    async (filePath) => ({ filePath, fingerprint: await statFingerprint(filePath) }),
  );
  const observed = fingerprints.filter(
    (item): item is { filePath: string; fingerprint: SessionFileFingerprint } => item.fingerprint !== null,
  );
  const observedPaths = new Set(observed.map((item) => item.filePath));
  let reused = 0;
  const entries = new Map<string, SessionIndexEntry>();
  const changed: Array<{ filePath: string; fingerprint: SessionFileFingerprint }> = [];

  for (const item of observed) {
    const cached = previous.get(item.filePath);
    if (cached && equalSessionFingerprint(cached.fingerprint, item.fingerprint)) {
      entries.set(item.filePath, cached);
      reused += 1;
    } else {
      changed.push(item);
    }
  }

  let unstable = 0;
  const parsedEntries = await mapWithConcurrency(changed, 2, async (item) => ({
    filePath: item.filePath,
    entry: await parseStableEntry(item.filePath, item.fingerprint),
  }));
  for (const item of parsedEntries) {
    if (item.entry) {
      entries.set(item.filePath, item.entry);
    } else {
      unstable += 1;
      const cached = previous.get(item.filePath);
      if (cached) entries.set(item.filePath, cached);
    }
  }

  let removed = 0;
  for (const filePath of previous.keys()) {
    if (!observedPaths.has(filePath)) removed += 1;
  }
  return { entries, parsed: changed.length - unstable, reused, removed, unstable };
}

export async function enumerateSessionFiles(sessionsDirectory: string): Promise<string[]> {
  try {
    const topLevel = await readdir(sessionsDirectory, { withFileTypes: true });
    const directories = topLevel
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(sessionsDirectory, entry.name));
    const directoryFiles = await mapWithConcurrency(directories, 8, async (directory) => {
      try {
        return (await readdir(directory))
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => join(directory, name));
      } catch {
        return [];
      }
    });
    return directoryFiles.flat();
  } catch {
    return [];
  }
}

export async function reconcileSessionPaths(
  filePaths: string[],
  previous: ReadonlyMap<string, SessionIndexEntry>,
): Promise<SessionIndexReconcileResult> {
  const normalizedPaths = [...new Set(filePaths.map((filePath) => normalizePath(filePath)))];
  const scopedPrevious = new Map<string, SessionIndexEntry>();
  for (const filePath of normalizedPaths) {
    const cached = previous.get(filePath);
    if (cached) scopedPrevious.set(filePath, cached);
  }
  const scoped = await reconcileSessionFiles(normalizedPaths, scopedPrevious);
  const entries = new Map(previous);
  for (const filePath of normalizedPaths) entries.delete(filePath);
  for (const [filePath, entry] of scoped.entries) entries.set(filePath, entry);
  return { ...scoped, entries };
}

export function indexedSessionMetadata(
  entries: ReadonlyMap<string, SessionIndexEntry>,
): IndexedSessionMetadata[] {
  return [...entries.values()]
    .flatMap((entry) => entry.metadata ? [entry.metadata] : [])
    .sort((left, right) => right.modified.localeCompare(left.modified));
}
