import type { AgentMessage, AssistantMessage, SessionEntry, ToolResultMessage } from "./types";
import { normalizeToolCalls } from "./normalize";
import { extractTurnWrittenFiles } from "./turn-written-files";

export type SessionFileKind = "markdown" | "html" | "code" | "data" | "image" | "other";

export const SESSION_FILE_FILTERS = ["all", "markdown", "html", "code", "data", "image", "other"] as const;
export type SessionFileFilter = (typeof SESSION_FILE_FILTERS)[number];

/** One short string. Shared across sessions in this browser, not written into the session file. */
export const SESSION_FILE_FILTER_STORAGE_KEY = "pi-session-files-filter";

export function parseSessionFileFilter(value: unknown): SessionFileFilter {
  return typeof value === "string" && (SESSION_FILE_FILTERS as readonly string[]).includes(value)
    ? value as SessionFileFilter
    : "all";
}

export function readSessionFileFilter(storage: { getItem(key: string): string | null } | null): SessionFileFilter {
  try {
    return parseSessionFileFilter(storage?.getItem(SESSION_FILE_FILTER_STORAGE_KEY));
  } catch {
    return "all";
  }
}

export function writeSessionFileFilter(
  storage: { setItem(key: string, value: string): void } | null,
  filter: SessionFileFilter,
): void {
  try {
    storage?.setItem(SESSION_FILE_FILTER_STORAGE_KEY, filter);
  } catch {
    // Private mode can reject localStorage. The in-memory choice still applies.
  }
}

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const DATA_EXTENSIONS = new Set(["json", "jsonl", "yaml", "yml", "csv", "tsv", "toml"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"]);
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "kts",
  "swift", "c", "h", "cc", "cpp", "hpp", "cs", "rb", "php", "sh", "bash", "zsh",
  "sql", "css", "scss", "less", "vue", "svelte", "lua",
]);

export interface SessionWrittenFile {
  filePath: string;
  writeCount: number;
  /** Milliseconds of the latest successful write tool result, when the session recorded one. */
  sessionWrittenAtMs?: number;
  kind: SessionFileKind;
}

/** Body-free successful write evidence, also used to deduplicate history and live events. */
export interface SessionFileWrite {
  toolCallId: string;
  filePath: string;
  sessionWrittenAtMs?: number;
}

export interface SessionWrittenFileManifest {
  leafId: string | null;
  writes: SessionFileWrite[];
}

function fileExtension(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = filePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Html is its own kind. A `.tsx` file stays code, and a path mentioned only in prose never reaches here. */
export function classifySessionFile(filePath: string): SessionFileKind {
  const extension = fileExtension(filePath);
  if (HTML_EXTENSIONS.has(extension)) return "html";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  return "other";
}

export function sessionFileLocation(filePath: string, cwd?: string): { name: string; directory: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  let directory = slash >= 0 ? normalized.slice(0, slash) : "";
  if (cwd) {
    const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    if (directory === root) directory = "";
    else if (root && directory.startsWith(`${root}/`)) directory = directory.slice(root.length + 1);
  }
  return { name: name || filePath, directory };
}

function assistantMessages(
  messages: readonly AgentMessage[],
  streamingMessage?: AssistantMessage | null,
): AssistantMessage[] {
  const assistants = messages.filter((message): message is AssistantMessage => message.role === "assistant");
  if (streamingMessage && streamingMessage !== assistants[assistants.length - 1]) {
    assistants.push(streamingMessage);
  }
  return assistants;
}

function collectSessionFileWrites(
  messages: readonly AgentMessage[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
  streamingMessage?: AssistantMessage | null,
): SessionFileWrite[] {
  const seenCalls = new Set<string>();
  const writes: SessionFileWrite[] = [];
  for (const message of assistantMessages(messages, streamingMessage)) {
    for (const block of message.content ?? []) {
      if (block.type !== "toolCall") continue;
      const written = extractTurnWrittenFiles([block], toolResults, cwd);
      const at = toolResults?.get(block.toolCallId)?.timestamp ?? message.timestamp;
      for (const file of written) {
        const key = `${block.toolCallId}\0${file.filePath}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        writes.push({
          toolCallId: block.toolCallId,
          filePath: file.filePath,
          ...(typeof at === "number" && Number.isFinite(at) ? { sessionWrittenAtMs: at } : {}),
        });
      }
    }
  }
  return writes;
}

/** The caller supplies the reader-selected full ancestor chain, including compacted entries. */
export function collectSessionWrittenFileManifest(
  branch: readonly SessionEntry[],
  leafId: string | null,
  cwd?: string,
): SessionWrittenFileManifest {
  const assistants: AgentMessage[] = [];
  const results = new Map<string, ToolResultMessage>();
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "assistant" && entry.message.role !== "toolResult") continue;
    const message = normalizeToolCalls(entry.message);
    if (message.role === "assistant") {
      assistants.push({ ...message, content: Array.isArray(message.content)
        ? message.content.filter((block) => block.type === "toolCall") : [] });
    } else if (message.role === "toolResult") {
      results.set(message.toolCallId, message);
    }
  }
  return { leafId, writes: collectSessionFileWrites(assistants, results, cwd) };
}

/** Merge complete branch evidence with loaded history/live writes, counting each call/path once. */
export function collectSessionWrittenFiles(
  messages: readonly AgentMessage[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
  streamingMessage?: AssistantMessage | null,
  manifestWrites: readonly SessionFileWrite[] = [],
): SessionWrittenFile[] {
  const seenCalls = new Set<string>();
  const byPath = new Map<string, { writeCount: number; sessionWrittenAtMs?: number }>();
  for (const write of [...manifestWrites, ...collectSessionFileWrites(messages, toolResults, cwd, streamingMessage)]) {
    const key = `${write.toolCallId}\0${write.filePath}`;
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    const current = byPath.get(write.filePath) ?? { writeCount: 0 };
    current.writeCount += 1;
    const at = write.sessionWrittenAtMs;
    if (typeof at === "number" && Number.isFinite(at)) {
      current.sessionWrittenAtMs = current.sessionWrittenAtMs === undefined ? at : Math.max(current.sessionWrittenAtMs, at);
    }
    byPath.set(write.filePath, current);
  }
  return [...byPath.entries()]
    .map(([filePath, info]) => ({
      filePath,
      writeCount: info.writeCount,
      sessionWrittenAtMs: info.sessionWrittenAtMs,
      kind: classifySessionFile(filePath),
    }))
    .sort((a, b) => (b.sessionWrittenAtMs ?? -1) - (a.sessionWrittenAtMs ?? -1) || a.filePath.localeCompare(b.filePath));
}

/** Stable while assistant text streams and changes only when a recorded write changes. */
export function sessionWrittenFileKey(
  messages: readonly AgentMessage[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
  streamingMessage?: AssistantMessage | null,
  manifestWrites: readonly SessionFileWrite[] = [],
): string {
  return collectSessionWrittenFiles(messages, toolResults, cwd, streamingMessage, manifestWrites)
    .map((file) => `${file.filePath}\0${file.writeCount}\0${file.sessionWrittenAtMs ?? ""}`)
    .join("\n");
}
