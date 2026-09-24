import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** Which config file a server lives in. */
export type McpConfigScope = "global" | "project";

/** One MCP server definition, as written in `mcp.json`. */
export interface McpServerConfig {
  /** stdio transport: the executable to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** streamable HTTP transport: the server URL. */
  url?: string;
  /** Optional display name; the config key is the identity. */
  name?: string;
}

/** A configured server plus where it came from. */
export interface McpServerView {
  name: string;
  scope: McpConfigScope;
  config: McpServerConfig;
  /** Absolute path of the file holding this entry. */
  path: string;
}

export interface McpConfigDiagnostic {
  path: string;
  message: string;
}

export interface McpServersSnapshot {
  servers: McpServerView[];
  diagnostics: McpConfigDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getGlobalMcpConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "mcp.json");
}

export function getProjectMcpConfigPath(cwd: string): string {
  return join(cwd, ".pi", "mcp.json");
}

export function getMcpConfigPath(scope: McpConfigScope, cwd: string): string {
  return scope === "project" ? getProjectMcpConfigPath(cwd) : getGlobalMcpConfigPath();
}

/**
 * Read one config file as raw JSON.
 *
 * The raw object is returned alongside the servers so writers can round-trip
 * keys this app does not own instead of dropping them.
 */
export function readMcpConfigFile(
  path: string,
): { raw: Record<string, unknown>; diagnostics: McpConfigDiagnostic[] } {
  if (!existsSync(path)) return { raw: {}, diagnostics: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      return { raw: {}, diagnostics: [{ path, message: "expected a JSON object at the top level" }] };
    }
    return { raw: parsed, diagnostics: [] };
  } catch (error) {
    return {
      raw: {},
      diagnostics: [{ path, message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function readServersFrom(
  path: string,
  scope: McpConfigScope,
  out: McpServerView[],
  diagnostics: McpConfigDiagnostic[],
): void {
  const { raw, diagnostics: fileDiagnostics } = readMcpConfigFile(path);
  diagnostics.push(...fileDiagnostics);
  if (fileDiagnostics.length > 0) return;

  const declared = raw.mcpServers;
  if (declared === undefined) return;
  if (!isRecord(declared)) {
    diagnostics.push({ path, message: '"mcpServers" must be an object' });
    return;
  }

  for (const [name, config] of Object.entries(declared)) {
    if (!isRecord(config)) {
      diagnostics.push({ path, message: `server "${name}" must be an object` });
      continue;
    }
    out.push({ name, scope, config: config as McpServerConfig, path });
  }
}

/**
 * Read both config files. Project entries are listed after global ones so a
 * same-named project server shadows the global one, matching what the pi
 * extension resolves at runtime.
 */
export function readMcpServers(cwd: string, agentDir = getAgentDir()): McpServersSnapshot {
  const servers: McpServerView[] = [];
  const diagnostics: McpConfigDiagnostic[] = [];
  readServersFrom(getGlobalMcpConfigPath(agentDir), "global", servers, diagnostics);
  readServersFrom(getProjectMcpConfigPath(cwd), "project", servers, diagnostics);
  return { servers, diagnostics };
}

/** Config keys the MCP bridge understands; anything else is preserved untouched. */
const KNOWN_CONFIG_KEYS = ["command", "args", "env", "cwd", "url", "name"] as const;

/** Reject a name that cannot be used as a config key. */
export function validateServerName(name: unknown): string | undefined {
  if (typeof name !== "string") return "name is required";
  const trimmed = name.trim();
  if (!trimmed) return "name is required";
  if (trimmed.length > 64) return "name must be at most 64 characters";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return "name may only contain letters, digits, dot, dash, and underscore";
  }
  return undefined;
}

/**
 * Validate a server config.
 *
 * Exactly one transport must be configured: stdio (`command`) or streamable
 * HTTP (`url`). Spawning without an explicit command is never inferred, so a
 * malformed entry fails here rather than at spawn time.
 */
export function validateServerConfig(config: unknown): string | undefined {
  if (!isRecord(config)) return "config must be an object";
  const hasCommand = config.command !== undefined;
  const hasUrl = config.url !== undefined;
  if (hasCommand && hasUrl) return 'set either "command" (stdio) or "url" (HTTP), not both';
  if (!hasCommand && !hasUrl) return 'set "command" (stdio) or "url" (HTTP)';
  if (hasCommand && (typeof config.command !== "string" || !config.command.trim())) {
    return '"command" must be a non-empty string';
  }
  if (hasUrl) {
    if (typeof config.url !== "string" || !config.url.trim()) return '"url" must be a non-empty string';
    try {
      const parsed = new URL(config.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return '"url" must use http or https';
      }
    } catch {
      return '"url" must be a valid URL';
    }
  }
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))) {
    return '"args" must be an array of strings';
  }
  if (config.env !== undefined) {
    if (!isRecord(config.env) || Object.values(config.env).some((value) => typeof value !== "string")) {
      return '"env" must be an object of string values';
    }
  }
  if (config.cwd !== undefined && typeof config.cwd !== "string") return '"cwd" must be a string';
  if (config.name !== undefined && typeof config.name !== "string") return '"name" must be a string';
  return undefined;
}

/** Keep only the keys the bridge understands, so unknown input cannot be injected. */
export function sanitizeServerConfig(config: Record<string, unknown>): McpServerConfig {
  const next: McpServerConfig = {};
  for (const key of KNOWN_CONFIG_KEYS) {
    const value = config[key];
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function writeMcpConfigFile(path: string, raw: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}

/**
 * Insert or replace one server in one scope.
 *
 * Unknown top-level keys and unknown server-level keys survive the round trip,
 * so hand-written extra fields and future schema additions are not destroyed.
 * Returns the validation error, or undefined on success.
 */
export function saveMcpServer(
  scope: McpConfigScope,
  cwd: string,
  name: string,
  config: unknown,
): string | undefined {
  const configError = validateServerConfig(config);
  if (configError) return configError;
  if (!isRecord(config)) return "config must be an object";

  const path = getMcpConfigPath(scope, cwd);
  const { raw } = readMcpConfigFile(path);
  const existingServers = isRecord(raw.mcpServers) ? raw.mcpServers : {};
  const previous = isRecord(existingServers[name]) ? existingServers[name] : {};
  writeMcpConfigFile(path, {
    ...raw,
    mcpServers: {
      ...existingServers,
      [name]: { ...previous, ...sanitizeServerConfig(config) },
    },
  });
  return undefined;
}

/** Remove one server from one scope. Returns false when it was not there. */
export function removeMcpServer(scope: McpConfigScope, cwd: string, name: string): boolean {
  const path = getMcpConfigPath(scope, cwd);
  const { raw } = readMcpConfigFile(path);
  if (!isRecord(raw.mcpServers) || !(name in raw.mcpServers)) return false;
  const nextServers = { ...raw.mcpServers };
  delete nextServers[name];
  writeMcpConfigFile(path, { ...raw, mcpServers: nextServers });
  return true;
}

/** Whether a server is directly startable, or the reason it is not. */
export function serverConfigError(config: McpServerConfig): string | undefined {
  return validateServerConfig(config);
}
