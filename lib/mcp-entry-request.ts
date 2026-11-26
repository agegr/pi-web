import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { getAgentDir, type McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpErrorResponse, McpRefusalReason, McpScope } from "./api-types";
import { isMcpDisabledByOperator, MCP_DISABLE_VARIABLE } from "./builtin-extensions";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { readMcpServerDefinition, readMcpServerEntry } from "./mcp-config-read";
import { findWebPasswordField } from "./mcp-transport";
import { loadPiSdkInternals, type PiSdkInternals } from "./pi-sdk-internals";
import { getProjectTrustStatus } from "./project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";
import { errorMessage } from "./errors";
import { isRecord } from "./is-record";

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
  /** The `configKey` GET reports for the entry. */
  configKey: string;
  /** The entry as the SDK's validator returned it; for a project override, the global entry with its keys. */
  config: McpServerConfig;
  /**
   * The folder the connection runs in: the panel's project when it has one,
   * else the home folder (the CLI would use its own working directory). The
   * server picks the fallback, so it is not checked against the allowed roots.
   */
  cwd: string;
}

export function mcpEntryRefusal(
  status: number,
  reason: McpRefusalReason,
  error: string,
  params: Pick<McpErrorResponse, "path" | "name"> = {},
): McpEntryRefusal {
  return { status, body: { error, reason, ...params } };
}

/** The HTTP answer that refuses a request: `{ error, reason, ...params }` with the status. */
export function mcpRefusalResponse(
  status: number,
  reason: McpRefusalReason,
  error: string,
  params: Omit<McpErrorResponse, "error" | "reason"> = {},
): Response {
  return Response.json({ error, reason, ...params } satisfies McpErrorResponse, { status });
}

/** The HTTP answer for a refusal one of this module's checks returned. */
export function mcpEntryRefusalResponse(refusal: McpEntryRefusal): Response {
  return Response.json(refusal.body, { status: refusal.status });
}

export function isMcpEntryRefusal(value: unknown): value is McpEntryRefusal {
  return isRecord(value) && typeof value.status === "number" && isRecord(value.body);
}

/**
 * What a session would connect for entry `name` of `scope`, read as the
 * listing reads it: the validator's copy, or for a project override the
 * global entry with the override's keys, and the `configKey` GET reports for
 * it. A string says why pi refuses it: the validator's reason, or what
 * `loadMcpConfig()` skips beyond it (a name another entry's namespace already
 * has, `auth` in a project file, whose provider token would otherwise go to a
 * URL the repository chose, or an override with nothing to override).
 */
export function readMcpServerConfig(options: {
  agentDir: string;
  project?: McpRequestProject;
  internals: PiSdkInternals;
  scope: McpScope;
  name: string;
}): { config: McpServerConfig; configKey: string } | string {
  const { agentDir, project, internals, scope, name } = options;
  const listed = readMcpServerDefinition({ agentDir, project, internals, scope, name });
  if (!listed) return `MCP server "${name}" is not listed`;
  if (listed.info.invalidError !== undefined) return listed.info.invalidError;
  if (!listed.config) return `MCP server "${name}" cannot be read`;
  return { config: listed.config, configKey: listed.info.configKey };
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

/** A server name a request may carry: a non-empty string of at most 1024 characters. */
export function readMcpServerName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 ? value : undefined;
}

/** `global` or `project`; undefined for anything else. */
export function readMcpScope(value: unknown): McpScope | undefined {
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
  const scope = readMcpScope(body.scope);
  const name = readMcpServerName(body.name);
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
    const resolved = readMcpServerConfig({ agentDir, project, internals, scope, name });
    if (typeof resolved === "string") return mcpEntryRefusal(409, "server-invalid", resolved, { name });
    const { config, configKey } = resolved;
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
      configKey,
      config,
      cwd: project?.cwd ?? homedir(),
    };
  } catch (error) {
    return mcpEntryRefusal(500, "internal", errorMessage(error));
  }
}
