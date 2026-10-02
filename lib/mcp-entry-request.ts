import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { getAgentDir, type McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpErrorResponse, McpRefusalReason, McpScope } from "./api-types";
import { isMcpDisabledByOperator, MCP_DISABLE_VARIABLE } from "./builtin-extensions";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { readMcpServerEntry } from "./mcp-config-read";
import { findWebPasswordField } from "./mcp-transport";
import { loadPiSdkInternals, type PiSdkInternals } from "./pi-sdk-internals";
import { getProjectTrustStatus } from "./project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";

// The checks a route makes before it connects one `mcp.json` entry outside any
// session: Settings › MCP's Test (`POST /api/mcp/test`) and its sign-in
// (`POST /api/mcp/sign-in`). Each starts a process or contacts a URL and may
// run a `!command` value, so each re-checks everything a session's start
// would: the request is Pi Web's own, MCP is not off, the entry is read from
// its file (never a config from the browser) and valid, it does not reference
// PI_WEB_PASSWORD, and a project entry's folder is allowed and trusted.

export interface McpEntryRefusal {
  status: number;
  body: McpErrorResponse;
}

export type McpRequestProject = { cwd: string; allowedRoots: Set<string> };

/** An entry a route may connect, as its file holds it. */
export interface McpConnectableEntry {
  scope: McpScope;
  name: string;
  /** The panel's project, checked like any cwd. */
  project?: McpRequestProject;
  agentDir: string;
  internals: PiSdkInternals;
  /** The configured path of its file, as `McpServerInfo.sourcePath` names it. */
  sourcePath: string;
  /** `mcpConfigKey()` of the raw entry. */
  configKey: string;
  /** The entry as the SDK's validator returned it. */
  config: McpServerConfig;
  /**
   * The folder the connection runs in: the panel's project when it has one,
   * else the home folder (the CLI would use its own working directory). The
   * server picks the fallback, so it is not checked against the allowed roots.
   */
  cwd: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mcpEntryRefusal(
  status: number,
  reason: McpRefusalReason,
  error: string,
  params: Pick<McpErrorResponse, "path" | "name"> = {},
): McpEntryRefusal {
  return { status, body: { error, reason, ...params } };
}

export function isMcpEntryRefusal(value: unknown): value is McpEntryRefusal {
  return isRecord(value) && typeof value.status === "number" && isRecord(value.body);
}

/**
 * The folder a request names as its project, checked alike by every route
 * that takes one for Settings › MCP or the trust dialog (`/api/mcp`, its Test
 * and sign-in, `/api/project-trust`): absolute (400 `cwd-invalid`), inside the
 * allowed roots as given — a `..` is refused, not collapsed (403
 * `cwd-denied`) — and only then a directory (400 `cwd-not-directory`), so a
 * folder outside the roots gets the same answer whether or not it exists.
 */
export async function validateMcpProject(value: unknown): Promise<McpRequestProject | McpEntryRefusal> {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) {
    return mcpEntryRefusal(400, "cwd-invalid", "cwd must be an absolute path");
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(value, allowedRoots)) return mcpEntryRefusal(403, "cwd-denied", "Access denied");
  const cwd = resolve(value);
  let directory = false;
  try {
    directory = statSync(cwd).isDirectory();
  } catch {
    // Removed since the check.
  }
  if (!directory) return mcpEntryRefusal(400, "cwd-not-directory", "cwd must be a directory");
  return { cwd, allowedRoots };
}

/**
 * The SDK's internals, or MCP off as every Settings › MCP route reads it: the
 * operator's switch (`PI_WEB_DISABLE_MCP`), which nothing in the browser may
 * override, or SDK modules that cannot load, without which nothing can be
 * checked, written or connected through Pi Web's transport. `-builtin:mcp`
 * does not count: a project may reverse that setting, and an explicit action
 * still works. `doing` ends the operator's message ("so Pi Web …").
 */
export async function mcpInternalsOrRefusal(doing: string): Promise<PiSdkInternals | McpEntryRefusal> {
  if (isMcpDisabledByOperator()) return mcpEntryRefusal(409, "mcp-off", `${MCP_DISABLE_VARIABLE} is set, so Pi Web ${doing}`);
  const internals = await loadPiSdkInternals();
  if (!internals.ok) return mcpEntryRefusal(409, "mcp-off", `Pi Web cannot load the SDK's MCP modules: ${internals.reason}`);
  return internals;
}

function readScope(value: unknown): McpScope | undefined {
  return value === "global" || value === "project" ? value : undefined;
}

/**
 * Whether a decision, exact or inherited, trusts the project: the MCP host's
 * rule (`mayReadProjectConfigNow()`). Never `trusted`, which a folder with no
 * trust-requiring resources has without any decision; without this, a route
 * would run an untrusted repository's command. Undefined when trusted.
 */
export function mcpProjectTrustRefusal(
  cwd: string,
  agentDir: string,
  untrustedMessage = "The project is not trusted, so Pi Web does not start its MCP servers",
): McpEntryRefusal | undefined {
  try {
    const status = getProjectTrustStatus(cwd, agentDir);
    // A folder that requires no trust reports an unreadable store here instead of throwing.
    if (status.decisionError !== undefined) return mcpEntryRefusal(409, "trust-unreadable", status.decisionError);
    if (status.decision !== true) return mcpEntryRefusal(403, "project-untrusted", untrustedMessage);
    return undefined;
  } catch (error) {
    return mcpEntryRefusal(409, "trust-unreadable", errorMessage(error));
  }
}

/**
 * Reads `{ scope, name, cwd? }` from a JSON POST and the entry it names, in
 * the order a refusal is most useful: origin (403 `request-denied`), JSON
 * (415, 400 `invalid-request`), the cwd (`cwd-*`; required for a project
 * entry), MCP off (409 `mcp-off`: `PI_WEB_DISABLE_MCP`, or SDK modules that
 * cannot load; `-builtin:mcp` does not count, an explicit action still
 * works), the project's trust, then the entry: its file's problems, missing
 * (`server-missing`), not an object, refused by the SDK's validator
 * (`server-invalid`), or referencing PI_WEB_PASSWORD (`web-password`).
 */
export async function readConnectableMcpEntry(req: Request): Promise<McpConnectableEntry | McpEntryRefusal> {
  if (!isApiRequestAllowed(req)) return mcpEntryRefusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return mcpEntryRefusal(415, "content-type", "Content-Type must be application/json");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpEntryRefusal(400, "invalid-request", "Invalid JSON body");
  }
  if (!isRecord(body)) return mcpEntryRefusal(400, "invalid-request", "Expected a JSON object");
  const scope = readScope(body.scope);
  const name = typeof body.name === "string" && body.name.length > 0 && body.name.length <= 1024 ? body.name : undefined;
  if (!scope || name === undefined) {
    return mcpEntryRefusal(400, "invalid-request", "scope must be \"global\" or \"project\", and name a server name");
  }

  let project: McpRequestProject | undefined;
  if (body.cwd !== undefined && body.cwd !== null) {
    const result = await validateMcpProject(body.cwd);
    if (isMcpEntryRefusal(result)) return result;
    project = result;
  }
  if (scope === "project" && !project) return mcpEntryRefusal(400, "invalid-request", "A project server needs the project's cwd");

  const internals = await mcpInternalsOrRefusal("connects no MCP server");
  if (isMcpEntryRefusal(internals)) return internals;

  const agentDir = getAgentDir();
  if (scope === "project" && project) {
    const refused = mcpProjectTrustRefusal(project.cwd, agentDir);
    if (refused) return refused;
  }

  try {
    const read = readMcpServerEntry({ agentDir, scope, name, project });
    if (!read.ok) {
      const params = { path: read.path, ...(read.reason === "server-missing" ? { name } : {}) };
      if (read.reason === "unreadable") return mcpEntryRefusal(500, "internal", read.error, params);
      return mcpEntryRefusal(409, read.reason, read.error, params);
    }
    if (!isRecord(read.value)) {
      return mcpEntryRefusal(409, "entry-not-object", `${read.sourcePath} defines MCP server "${name}" as something other than an object`, { name });
    }
    const config = internals.validateMcpServerConfig(name, read.value);
    if (typeof config === "string") return mcpEntryRefusal(409, "server-invalid", config, { name });
    if (findWebPasswordField(config, internals)) {
      return mcpEntryRefusal(409, "web-password", `"${name}" references PI_WEB_PASSWORD, so Pi Web does not connect it`, { name });
    }
    return {
      scope,
      name,
      ...(project ? { project } : {}),
      agentDir,
      internals,
      sourcePath: read.sourcePath,
      configKey: read.configKey,
      config,
      cwd: project?.cwd ?? homedir(),
    };
  } catch (error) {
    return mcpEntryRefusal(500, "internal", errorMessage(error));
  }
}
