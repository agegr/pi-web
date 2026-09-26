/**
 * Client-safe MCP server status helpers.
 *
 * This module must stay free of Node-only imports (fs, os, path,
 * @earendil-works/pi-coding-agent, ./atomic-file, …) because it is imported
 * by the client component components/McpPanel.tsx. Server-side config
 * helpers live in ./mcp-servers.ts, which re-exports these pure functions
 * so existing server imports and tests keep working.
 */

/** Status shown in the panel; derived from config plus the live tool list. */
export type McpServerStatus = "disabled" | "active" | "inactive" | "not-loaded";

/** Adapter naming: namespace proxy is mcp__<server>, direct tools are <server>_<tool> (- → _). */
export function normalizeMcpServerPart(name: string): string {
  return name.replace(/-/g, "_");
}

export function getMcpServerToolCounts(
  tools: { name: string; active: boolean }[] | null,
  serverName: string,
): { active: number; total: number } {
  if (!tools) return { active: 0, total: 0 };
  const part = normalizeMcpServerPart(serverName);
  const proxy = `mcp__${part}`;
  const prefix = `${part}_`;
  let active = 0;
  let total = 0;
  for (const tool of tools) {
    if (tool.name === proxy || tool.name.startsWith(prefix)) {
      total += 1;
      if (tool.active) active += 1;
    }
  }
  return { active, total };
}

export function getMcpServerStatus(
  server: { disabled: boolean },
  counts: { active: number; total: number },
): McpServerStatus {
  if (server.disabled) return "disabled";
  if (counts.active > 0) return "active";
  if (counts.total > 0) return "inactive";
  return "not-loaded";
}
