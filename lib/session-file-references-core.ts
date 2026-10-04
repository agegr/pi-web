import type { SUBAGENT_CONTROL_TOOL_NAMES } from "./subagents";
import type { SessionEntry, ToolResultMessage } from "./types";

// Spelled out rather than imported: subagents.ts loads the SDK, and this module stays
// importable on its own. The type rejects a name subagents.ts no longer registers.
const SUBAGENT_TOOL_NAMES: ReadonlyArray<typeof SUBAGENT_CONTROL_TOOL_NAMES[number]> = [
  "Agent",
  "get_subagent_result",
  "steer_subagent",
];

// pi's coding tools, as `CODING_TOOL_NAMES` in rpc-manager.ts lists them.
const CODING_TOOL_NAMES = new Set<string>(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

// Tools whose result text may authorize a path it mentions: the coding tools and Pi
// Web's subagent tools. Every other result (MCP, codemode, third-party extensions)
// relays text a remote party controls.
const PATH_REPORTING_TOOL_NAMES = new Set<string>([...CODING_TOOL_NAMES, ...SUBAGENT_TOOL_NAMES]);

// The codemode extension's script store (`CODEMODE_STORE_ENTRY_TYPE` in the SDK): values a
// script saved, often straight from MCP results.
const CODEMODE_STORE_ENTRY_TYPE = "codemode-store";

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(sessionId: string | null): sessionId is string {
  return !!sessionId && SESSION_ID_RE.test(sessionId);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isPathChar(ch: string): boolean {
  return /[A-Za-z0-9._~+%@/\\:-]/.test(ch);
}

function hasReferenceBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const ch = text[index];
  if (ch === ":") return /\d/.test(text[index + 1] ?? "");
  return !isPathChar(ch);
}

function containsExactPathReference(text: string, filePath: string): boolean {
  const target = normalizeSlashes(filePath);
  const targets = target.startsWith("/") ? [target, `file://${target}`] : [target];
  const haystacks = new Set([normalizeSlashes(text), normalizeSlashes(safeDecode(text))]);

  for (const haystack of haystacks) {
    for (const t of targets) {
      let index = haystack.indexOf(t);
      while (index !== -1) {
        const before = index === 0 ? "" : haystack[index - 1];
        const afterIndex = index + t.length;
        if ((index === 0 || !isPathChar(before)) && hasReferenceBoundaryAfter(haystack, afterIndex)) {
          return true;
        }
        index = haystack.indexOf(t, index + 1);
      }
    }
  }

  return false;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  for (const item of Object.values(value)) collectStrings(item, out);
}

function recordField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * What the result of a tool outside PATH_REPORTING_TOOL_NAMES still authorizes:
 * the file its full output was spilled to, and the arguments of the coding-tool
 * calls it made through `ctx.executeTool()` (the SDK's `nestedCalls` record), the
 * files and commands the run actually operated on. Its other nested calls are left
 * out: script code passes one MCP result straight into the next MCP call without
 * the model reading it, so their arguments are as remote-controlled as the result.
 */
function collectUntrustedToolResultStrings(message: ToolResultMessage, out: string[]): void {
  const fullOutputPath = recordField(message.details, "fullOutputPath");
  if (typeof fullOutputPath === "string") out.push(fullOutputPath);
  const nestedCalls = recordField(recordField(message, "nestedCalls"), "calls");
  if (!Array.isArray(nestedCalls)) return;
  for (const call of nestedCalls) {
    const name = recordField(call, "name");
    if (typeof name === "string" && CODING_TOOL_NAMES.has(name)) {
      collectStrings(recordField(call, "arguments"), out);
    }
  }
}

function collectEntryStrings(entry: SessionEntry, out: string[]): void {
  if (entry.type === "custom" && entry.customType === CODEMODE_STORE_ENTRY_TYPE) return;
  // Replaces an earlier entry's model context, often with a trimmed tool result. The UI
  // never renders it, so counting it could only re-admit text the rules below refuse.
  if (entry.type === "context_edit") return;
  if (entry.type === "message") {
    const { message } = entry;
    // Provider input: the prompt sections and every tool's schema, never a link.
    if (message.role === "system") return;
    if (message.role === "toolResult" && !PATH_REPORTING_TOOL_NAMES.has(message.toolName ?? "")) {
      collectUntrustedToolResultStrings(message, out);
      return;
    }
  }
  collectStrings(entry, out);
}

export function isFilePathReferencedByEntries(filePath: string, entries: SessionEntry[]): boolean {
  for (const entry of entries) {
    const strings: string[] = [];
    collectEntryStrings(entry, strings);
    if (strings.some((text) => containsExactPathReference(text, filePath))) return true;
  }
  return false;
}

export function isBashOutputPathReferencedByEntries(filePath: string, entries: SessionEntry[]): boolean {
  return entries.some((entry) => (
    entry.type === "message"
    && entry.message.role === "bashExecution"
    && entry.message.fullOutputPath === filePath
  ));
}
