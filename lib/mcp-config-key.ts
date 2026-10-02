import { createHmac, randomBytes } from "node:crypto";

// How an `mcp.json` entry is identified across the modules that compare
// entries: the MCP host (`lib/mcp-host.ts`) diffs what it registered against
// the files, and Settings › MCP (`lib/mcp-config-read.ts`) lists entries with
// the key their last known status (`lib/mcp-status.ts`) was recorded under.
// The host writes those statuses too, and `mcp-config-read` already imports
// the host's module chain, so both live here rather than in either of them.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How deep `canonicalJson()` follows arrays and objects. Real entries are a
 * few levels deep; the entries hashed include an untrusted repository's
 * `.pi/mcp.json`, which `JSON.parse` accepts hundreds of thousands of levels
 * deep, and one recursion per level would overflow the stack at a few
 * thousand.
 */
export const MCP_CONFIG_KEY_MAX_DEPTH = 64;

/** What stands for an array or object below the depth limit: not JSON, so no value prints as it. */
const TOO_DEEP = "<too deep>";

/**
 * JSON with sorted keys, so an entry compares equal however its file orders it.
 * Total: past `MCP_CONFIG_KEY_MAX_DEPTH` levels an array or object prints as a
 * fixed marker instead of being followed. The result only has to be the same
 * for the same value, so two entries that differ only that deep compare equal.
 */
export function canonicalJson(value: unknown, depth = 0): string {
  if (Array.isArray(value) || isRecord(value)) {
    if (depth >= MCP_CONFIG_KEY_MAX_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// One key per server process: hot reload re-evaluates this module, globalThis keeps it.
const CONFIG_KEY_SECRET: symbol = Symbol.for("pi-web:mcp-config-key-secret");

/**
 * What identifies an entry's content, so a status recorded for it can be
 * dropped once the entry changes: an HMAC of its canonical JSON (sorted keys)
 * under a key this process picked at random. Never the JSON itself, which
 * would carry every literal env and header value to the browser, and not a
 * plain hash either, which a weak password in an otherwise visible entry
 * would not survive. Stable for the life of the process, like the statuses
 * it is compared with.
 */
export function mcpConfigKey(value: unknown): string {
  const store = globalThis as Record<symbol, Buffer | undefined>;
  const secret = (store[CONFIG_KEY_SECRET] ??= randomBytes(32));
  return createHmac("sha256", secret).update(canonicalJson(value)).digest("base64url");
}
