import type { McpOverrideKey } from "./api-types";
import { isRecord } from "./is-record";

// Project overrides of global MCP servers (pi 1.0.1): a project `.pi/mcp.json`
// entry without `command`, `url` or `type` changes only `enabled`, `exposure`
// and `toolExposure` of the global server of its name. The rules of the SDK's
// `loadMcpConfig()` and `updateMcpServerConfig()`, for the listing
// (`lib/mcp-config-read.ts`), the writer (`lib/mcp-config-file.ts`) and the
// MCP host (`lib/mcp-host.ts`), which may not import the listing.

/** What a project override may set (the SDK's module-private `OVERRIDE_KEYS`), in its order. */
export const MCP_OVERRIDE_KEYS: readonly McpOverrideKey[] = ["enabled", "exposure", "toolExposure"];

/**
 * Whether an entry overrides the global server of its name instead of
 * defining a server: the SDK's `isOverride()`, an object without `command`,
 * `url` or `type`. `loadMcpConfig()` reads one so only in a project file.
 */
export function isMcpOverrideEntry(value: unknown): boolean {
  return isRecord(value) && value.command === undefined && value.url === undefined && value.type === undefined;
}

/**
 * Why `loadMcpConfig()` skips a project override, in its words (less the
 * file's path, as the validator's): no global server of its name that loads,
 * or a key it may not set. Undefined when the override applies, once the
 * global entry with its keys passes the validator.
 */
export function mcpOverrideRefusal(name: string, value: Record<string, unknown>, hasBase: boolean): string | undefined {
  if (!hasBase) return `server "${name}" needs "command" or "url", or a global server to override`;
  const extra = Object.keys(value).some((key) => !(MCP_OVERRIDE_KEYS as readonly string[]).includes(key));
  return extra ? `server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(", ")}` : undefined;
}
