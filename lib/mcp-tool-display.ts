// Display names for MCP tools. pi registers them as `mcp__<server>__<tool>`,
// sanitized to `[A-Za-z0-9_-]` and shortened with a hash past 64 characters,
// so the registered name cannot be split back into the server's names:
// `docs.v2` / `search.pages` and `docs_v2` / `search_pages` register alike, and
// either part may hold `__`. pi's TUI labels them `server/tool` from the tool
// definition; the browser has those names only in a result's details
// (`{ server, tool }`). Without a result a call keeps its registered name,
// which is also the name codemode scripts call it by.

/** Larger results are shown as the server sent them. */
const PRETTY_JSON_MAX_CHARS = 200_000;
const MCP_TOOL_PREFIX = "mcp__";

export interface McpToolLabel {
  server: string;
  tool: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server and tool an MCP call's result names, or null when there is none to go by. */
export function mcpToolLabel(toolName: string, details?: unknown): McpToolLabel | null {
  if (!toolName.startsWith(MCP_TOOL_PREFIX) || !isRecord(details)) return null;
  const { server, tool } = details;
  return typeof server === "string" && typeof tool === "string" && server && tool ? { server, tool } : null;
}

/**
 * MCP servers often answer with one JSON document as text, compacted. Show it
 * indented; anything else, including JSON surrounded by other text, as sent.
 */
export function prettyMcpResultText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > PRETTY_JSON_MAX_CHARS || !/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
