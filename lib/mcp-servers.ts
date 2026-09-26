import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export {
  getMcpServerStatus,
  getMcpServerToolCounts,
  normalizeMcpServerPart,
} from "./mcp-server-status";
export type { McpServerStatus } from "./mcp-server-status";

/**
 * Server-side helpers behind /api/mcp and pi-web's MCP top panel.
 *
 * Scope is deliberately the pi-owned config files only:
 *   - global:  <agentDir>/mcp.json        (usually ~/.pi/agent/mcp.json)
 *   - project: <cwd>/.pi/mcp.json         (the file /mcp enable|disable writes)
 *
 * This mirrors pi-mcp-adapter's enable/disable file semantics for those two
 * files. Shared/host-import configs (.mcp.json, ~/.config/mcp/mcp.json,
 * Claude Desktop imports, …) are resolved by the adapter at session start and
 * are intentionally out of scope here; servers defined only there are not
 * listed, and the enable/disable toggle only ever touches the project file,
 * exactly like the adapter's own writeProjectServerDisabledOverride().
 */

export type McpTransport = "http" | "stdio" | "unknown";

export interface McpServerSummary {
  name: string;
  disabled: boolean;
  /** Which pi-owned file defines the server. */
  source: "project" | "global";
  /** True when both files define the server (project wins). */
  overridden: boolean;
  transport: McpTransport;
  /** Redacted transport hint: http origin+path (no query) or stdio command. */
  detail: string;
}

export interface McpServerList {
  servers: McpServerSummary[];
  globalPath: string;
  projectPath: string;
  projectFileExists: boolean;
}

/** Same default as the adapter; honors a rebranded PI_PACKAGE_DIR manifest. */
export function getMcpConfigDirName(): string {
  const dir = process.env.PI_PACKAGE_DIR?.trim();
  if (dir) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(path.resolve(dir), "package.json"), "utf8")) as {
        piConfig?: { configDir?: unknown };
      };
      const configDir = manifest.piConfig?.configDir;
      if (typeof configDir === "string" && configDir.trim()) return configDir.trim();
    } catch {
      // Fall through to the default.
    }
  }
  return ".pi";
}

export function getGlobalMcpPath(): string {
  return path.join(getAgentDir(), "mcp.json");
}

export function getProjectMcpPath(cwd: string): string {
  return path.join(cwd, getMcpConfigDirName(), "mcp.json");
}

/** Conservative key charset: must be usable as a JSON key and shell-safe. */
export function isValidMcpServerName(name: string): boolean {
  return typeof name === "string"
    && name.length >= 1
    && name.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(name);
}

type McpServersObject = Record<string, Record<string, unknown>>;

function readMcpFile(filePath: string): { servers: McpServersObject; raw: Record<string, unknown> } {
  if (!existsSync(filePath)) return { servers: {}, raw: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new Error(`Cannot parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid MCP config at ${filePath}: root value must be an object`);
  }
  const raw = parsed as Record<string, unknown>;
  // Accept the legacy "mcp-servers" key, like the adapter does.
  const key = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const rawServers = key === "mcpServers" && raw.mcpServers === undefined ? {} : raw[key];
  if (rawServers !== undefined && (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers))) {
    throw new Error(`Invalid MCP config at ${filePath}: ${key} must be an object`);
  }
  const servers: McpServersObject = {};
  for (const [name, entry] of Object.entries((rawServers ?? {}) as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid MCP config at ${filePath}: server "${name}" must be an object`);
    }
    servers[name] = entry as Record<string, unknown>;
  }
  return { servers, raw };
}

function summarizeTransport(entry: Record<string, unknown>): { transport: McpTransport; detail: string } {
  if (typeof entry.url === "string" && entry.url) {
    try {
      const parsed = new URL(entry.url);
      return { transport: "http", detail: `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}` };
    } catch {
      return { transport: "http", detail: "http" };
    }
  }
  if (typeof entry.command === "string" && entry.command) {
    return { transport: "stdio", detail: entry.command };
  }
  return { transport: "unknown", detail: "" };
}

export function loadMcpServerList(cwd: string): McpServerList {
  const globalPath = getGlobalMcpPath();
  const projectPath = getProjectMcpPath(cwd);
  const global = readMcpFile(globalPath);
  const project = readMcpFile(projectPath);
  const names = [...new Set([...Object.keys(global.servers), ...Object.keys(project.servers)])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const servers: McpServerSummary[] = names.map((name) => {
    const inProject = project.servers[name] !== undefined;
    const entry = (inProject ? project.servers[name] : global.servers[name]) as Record<string, unknown>;
    const { transport, detail } = summarizeTransport(entry);
    return {
      name,
      disabled: entry.disabled === true,
      source: inProject ? "project" : "global",
      overridden: inProject && global.servers[name] !== undefined,
      transport,
      detail,
    };
  });
  return { servers, globalPath, projectPath, projectFileExists: existsSync(projectPath) };
}

export function readEffectiveMcpDisabled(cwd: string, server: string): boolean {
  const global = readMcpFile(getGlobalMcpPath());
  const project = readMcpFile(getProjectMcpPath(cwd));
  const entry = project.servers[server] ?? global.servers[server];
  return entry?.disabled === true;
}

/**
 * Enable/disable a server by editing the project override file only.
 * Mirrors the adapter's writeProjectServerDisabledOverride() for the pi-owned
 * subset: disabling sets disabled:true (creating the entry if needed);
 * enabling removes the local disabled flag, or writes an explicit
 * disabled:false when a lower (global) config disables the server.
 */
export function setMcpServerDisabled(
  cwd: string,
  server: string,
  disabled: boolean,
): { changed: boolean; path: string } {
  if (!isValidMcpServerName(server)) throw new Error(`Invalid server name: ${server}`);
  const filePath = getProjectMcpPath(cwd);
  const { servers, raw } = readMcpFile(filePath);
  const existing = servers[server];

  let next: Record<string, unknown>;
  if (disabled) {
    next = { ...existing, disabled: true };
  } else {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
    // A lower config may disable the server; then an explicit false is needed
    // to re-enable it from the project file.
    const global = readMcpFile(getGlobalMcpPath());
    if (global.servers[server]?.disabled === true) next.disabled = false;
  }

  if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
    return { changed: false, path: filePath };
  }
  const updated: McpServersObject = { ...servers };
  if (Object.keys(next).length === 0) delete updated[server];
  else updated[server] = next;

  const key = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const output: Record<string, unknown> = { ...raw, [key]: updated };
  mkdirSync(path.dirname(filePath), { recursive: true });
  // Mode 600: these files routinely carry secrets (tokens in urls, headers).
  writePrivateFileAtomicSync(filePath, `${JSON.stringify(output, null, 2)}\n`);
  return { changed: true, path: filePath };
}

/** Home-relative display path for the UI (never leaks absolute home paths). */
export function displayMcpPath(filePath: string): string {
  const home = homedir();
  return filePath === home ? "~" : filePath.startsWith(`${home}/`) ? `~/${filePath.slice(home.length + 1)}` : filePath;
}
