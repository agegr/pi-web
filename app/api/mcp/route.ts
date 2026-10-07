import { NextResponse } from "next/server";
import { getAgentDir, type McpExposure } from "@earendil-works/pi-coding-agent";
import type {
  McpActionItemResult,
  McpActionResponse,
  McpErrorResponse,
  McpRefusalReason,
  McpResponse,
  McpScope,
  McpServerRef,
  ProjectTrustStatus,
} from "@/lib/api-types";
import {
  insertMcpServer,
  isMcpConfigWriteError,
  removeMcpServer,
  setMcpServerExposure,
  setMcpServersEnabled,
  type McpConfigFileTarget,
  type McpEnabledOutcome,
} from "@/lib/mcp-config-file";
import {
  MCP_ADD_MAX_TEXT,
  prepareMcpAdd,
  readMcpAddSecretReferences,
  readMcpAddValues,
  type McpAddRefusal,
  type McpAddRequest,
} from "@/lib/mcp-add";
import { readMcpOverview, readMcpServerConfigs, readMcpServerEntry } from "@/lib/mcp-config-read";
import {
  isMcpEntryRefusal,
  mcpInternalsOrRefusal,
  mcpProjectTrustRefusal,
  validateMcpProject,
  type McpEntryRefusal,
} from "@/lib/mcp-entry-request";
import { MCP_EXPOSURES, isMcpExposure, suggestFreeName } from "@/lib/mcp-import";
import { mcpOAuthUrl, signOutMcpServer } from "@/lib/mcp-sign-in";
import { forgetMcpEntryStatuses } from "@/lib/mcp-status";
import { findWebPasswordField } from "@/lib/mcp-transport";
import { holdRemovedEntry, returnRemovedEntry, takeRemovedEntry } from "@/lib/mcp-undo";
import type { PiSdkInternals } from "@/lib/pi-sdk-internals";
import { invalidateModelsCache } from "@/lib/models-cache";
import { freshFolderTrustBreadth, getProjectTrustStatus, trustFreshFolderAndWrite } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// Settings › MCP (ADR 0006). GET reads files only: it never spawns a server,
// opens a connection, or runs a `!command` value, so it lists an untrusted
// project's servers as safely as the global ones. Without `cwd` it lists the
// global file alone; Settings › MCP does not need a project.
//
// POST changes one file through `lib/mcp-config-file.ts` (locked, atomic, the
// SDK editor's bytes) and answers with the overview GET would give, so the
// panel replaces its listing without a second request. Open sessions apply a
// change at their next message, when their MCP host reads the files again.
// `sign-out` changes `mcp-auth.json` instead, as `pi mcp logout` does. `add`
// parses pasted text again with the importer the panel previewed it with
// (`lib/mcp-add.ts`), and for a fresh folder trusts it in the same step.

type Project = { cwd: string; allowedRoots: Set<string> };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RefusalParams = Omit<McpErrorResponse, "error" | "reason">;

function refusal(status: number, reason: McpRefusalReason, error: string, params: RefusalParams = {}) {
  return NextResponse.json({ error, reason, ...params } satisfies McpErrorResponse, { status });
}

/** A typed refusal: the whole answer of a request, or one server's result in a bulk switch. */
class Refusal {
  constructor(
    readonly status: number,
    readonly reason: McpRefusalReason,
    readonly error: string,
    readonly params: RefusalParams = {},
  ) {}

  response() {
    return refusal(this.status, this.reason, this.error, this.params);
  }

  item(server: McpServerRef): McpActionItemResult {
    return { ...server, error: this.error, reason: this.reason };
  }
}

/** The shared checks of `lib/mcp-entry-request.ts`, as one of this route's refusals. */
function asRefusal(refused: McpEntryRefusal): Refusal {
  const { error, reason, ...params } = refused.body;
  return new Refusal(refused.status, reason, error, params);
}

/** The project folder the request names, checked as Test, sign-in and the trust route check it (`validateMcpProject()`). */
async function validateProject(value: unknown): Promise<Project | Refusal> {
  const result = await validateMcpProject(value);
  return isMcpEntryRefusal(result) ? asRefusal(result) : result;
}

// GET /api/mcp?cwd=<absolute project folder>
export async function GET(req: Request) {
  const value = new URL(req.url).searchParams.get("cwd");
  let project: Project | undefined;
  if (value !== null) {
    const result = await validateProject(value);
    if (result instanceof Refusal) return result.response();
    project = result;
  }

  try {
    return NextResponse.json((await readMcpOverview({ agentDir: getAgentDir(), project })) satisfies McpResponse);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}

/**
 * Where a write to `scope` goes. A project file is written only while a
 * decision, exact or inherited, trusts the folder: the rule the MCP host reads
 * it by (`mayReadProjectConfigNow()`), never `trusted`, which a folder with no
 * trust-requiring resources gets with no decision at all.
 */
function writeTarget(scope: McpScope, project: Project | undefined, agentDir: string): McpConfigFileTarget | Refusal {
  if (scope === "global") return { scope: "global", agentDir };
  if (!project) return new Refusal(400, "invalid-request", "A project server needs the project's cwd");
  const refused = mcpProjectTrustRefusal(project.cwd, agentDir, "The project is not trusted, so its .pi/mcp.json is not changed");
  if (refused) return asRefusal(refused);
  return { scope: "project", cwd: project.cwd, allowedRoots: project.allowedRoots };
}

/** A writer refusal as the route answers it: 409 for a file state the user can fix, 500 for anything else. */
function writeRefusal(error: unknown): Refusal {
  if (isMcpConfigWriteError(error)) {
    const params = { path: error.path, ...(error.serverName !== undefined ? { name: error.serverName } : {}) };
    if (error.reason === "unreadable") return new Refusal(500, "internal", error.message, params);
    return new Refusal(409, error.reason, error.message, params);
  }
  return new Refusal(500, "internal", errorMessage(error));
}

/**
 * MCP off means the panel is read-only: the operator turned it off for this
 * server (nothing in the browser may override that, and the pi CLI reads the
 * same files), or the SDK's MCP modules cannot load, so nothing can be
 * checked. `-builtin:mcp` does not: it is a setting a project may reverse, and
 * whether a global switch worked must not depend on the folder Settings shows.
 */
async function mcpWritable(): Promise<PiSdkInternals | Refusal> {
  const internals = await mcpInternalsOrRefusal("changes no MCP server");
  return isMcpEntryRefusal(internals) ? asRefusal(internals) : internals;
}

function readScope(value: unknown): McpScope | undefined {
  return value === "global" || value === "project" ? value : undefined;
}

function readName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 ? value : undefined;
}

const MAX_BULK_SERVERS = 500;

function readServerList(value: unknown): McpServerRef[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_SERVERS) return undefined;
  const servers = new Map<string, McpServerRef>();
  for (const item of value) {
    const scope = isRecord(item) ? readScope(item.scope) : undefined;
    const name = isRecord(item) ? readName(item.name) : undefined;
    if (!scope || name === undefined) return undefined;
    servers.set(`${scope}\0${name}`, { scope, name });
  }
  return [...servers.values()];
}

async function overviewResponse(agentDir: string, project: Project | undefined, extra: Omit<McpActionResponse, keyof McpResponse> = {}) {
  try {
    const overview = await readMcpOverview({ agentDir, project });
    return NextResponse.json({ ...overview, ...extra } satisfies McpActionResponse);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}

/** Turning on an entry that references PI_WEB_PASSWORD is refused: Pi Web would not connect it, and the pi CLI would send the password. */
function webPasswordRefusal(internals: PiSdkInternals) {
  return (_name: string, entry: Record<string, unknown>) => (findWebPasswordField(entry, internals) ? "web-password" as const : undefined);
}

/** Why the writer left one server as it was, as a 409; undefined when it now says what was asked. */
function outcomeRefusal(outcome: McpEnabledOutcome<"web-password">, path: string): Refusal | undefined {
  const name = outcome.name;
  switch (outcome.outcome) {
    case "missing":
      return new Refusal(409, "server-missing", `${path} does not define MCP server "${name}"`, { path, name });
    case "not-an-object":
      return new Refusal(409, "entry-not-object", `${path} defines MCP server "${name}" as something other than an object, so it has nothing to switch`, { path, name });
    case "refused":
      return new Refusal(409, "web-password", `"${name}" references PI_WEB_PASSWORD, so Pi Web does not turn it on`, { name });
    default:
      return undefined;
  }
}

async function switchServer(
  agentDir: string,
  project: Project | undefined,
  internals: PiSdkInternals,
  server: McpServerRef,
  enabled: boolean,
) {
  const target = writeTarget(server.scope, project, agentDir);
  if (target instanceof Refusal) return target.response();
  try {
    const { value: [outcome], path } = await setMcpServersEnabled(
      target,
      [server.name],
      enabled,
      enabled ? webPasswordRefusal(internals) : undefined,
    );
    const refused = outcomeRefusal(outcome, path);
    if (refused) return refused.response();
  } catch (error) {
    return writeRefusal(error).response();
  }
  return overviewResponse(agentDir, project);
}

/**
 * How one server's tools reach the model. Nothing connects because of it:
 * open sessions register the changed entry again at their next message, so
 * an entry that references PI_WEB_PASSWORD may change too, and stays off.
 */
async function setServerExposure(
  agentDir: string,
  project: Project | undefined,
  server: McpServerRef,
  exposure: McpExposure,
) {
  const target = writeTarget(server.scope, project, agentDir);
  if (target instanceof Refusal) return target.response();
  try {
    const { value: outcome, path } = await setMcpServerExposure(target, server.name, exposure);
    const refused = outcomeRefusal(outcome, path);
    if (refused) return refused.response();
  } catch (error) {
    return writeRefusal(error).response();
  }
  return overviewResponse(agentDir, project);
}

/**
 * The group switch: every server asked for, one write per file, and a result
 * per server, so one the route refuses (removed meanwhile, not an object,
 * referencing PI_WEB_PASSWORD, in an untrusted project, in a file that no
 * longer parses) keeps the rest from failing.
 */
async function switchServers(
  agentDir: string,
  project: Project | undefined,
  internals: PiSdkInternals,
  servers: McpServerRef[],
  enabled: boolean,
) {
  const results = new Map<string, McpActionItemResult>();
  const key = (server: McpServerRef) => `${server.scope}\0${server.name}`;
  for (const scope of ["global", "project"] as const) {
    const group = servers.filter((server) => server.scope === scope);
    if (group.length === 0) continue;
    const target = writeTarget(scope, project, agentDir);
    if (target instanceof Refusal) {
      for (const server of group) results.set(key(server), target.item(server));
      continue;
    }
    try {
      const { value: outcomes, path } = await setMcpServersEnabled(
        target,
        group.map((server) => server.name),
        enabled,
        enabled ? webPasswordRefusal(internals) : undefined,
      );
      for (const outcome of outcomes) {
        const server = { scope, name: outcome.name };
        results.set(key(server), outcomeRefusal(outcome, path)?.item(server) ?? server);
      }
    } catch (error) {
      const failure = writeRefusal(error);
      for (const server of group) results.set(key(server), failure.item(server));
    }
  }
  return overviewResponse(agentDir, project, { results: servers.map((server) => results.get(key(server)) ?? server) });
}

async function removeServer(agentDir: string, project: Project | undefined, server: McpServerRef) {
  const target = writeTarget(server.scope, project, agentDir);
  if (target instanceof Refusal) return target.response();
  let removed: Awaited<ReturnType<typeof removeMcpServer>>;
  try {
    removed = await removeMcpServer(target, server.name);
  } catch (error) {
    return writeRefusal(error).response();
  }
  const { token, expiresAt } = holdRemovedEntry({
    ...server,
    path: removed.path,
    ...(target.scope === "project" ? { cwd: target.cwd } : {}),
    entry: removed.value.entry,
    index: removed.value.index,
  });
  return overviewResponse(agentDir, project, {
    undo: { ...server, token, path: removed.path, expiresInMs: Math.max(0, expiresAt - Date.now()) },
  });
}

/**
 * Puts a removed entry back where it stood, under the same checks as any
 * write: a project entry's folder must still be allowed and trusted. The
 * entry is restored as it was, a PI_WEB_PASSWORD reference included, since
 * undo returns the file to what it held a moment ago; the panel shows such an
 * entry as refused. A name the file defines again since is never replaced.
 */
async function undoRemoval(agentDir: string, project: Project | undefined, token: string) {
  const held = takeRemovedEntry(token);
  if (!held) return refusal(410, "undo-unavailable", "Nothing to undo: the removal is unknown, already undone, or older than 60 seconds");
  const server = { scope: held.scope, name: held.name };
  let failure: Refusal | undefined;
  try {
    let heldProject: Project | undefined;
    if (held.scope === "project") {
      const result = await validateProject(held.cwd);
      if (result instanceof Refusal) failure = result;
      else heldProject = result;
    }
    if (!failure) {
      const target = writeTarget(held.scope, heldProject, agentDir);
      if (target instanceof Refusal) failure = target;
      else await insertMcpServer(target, held.name, held.entry, held.index);
    }
  } catch (error) {
    failure = isMcpConfigWriteError(error) && error.reason === "name-taken"
      ? new Refusal(409, "undo-name-taken", `${error.path} defines "${held.name}" again, so the removal is not undone`, {
          path: error.path,
          name: held.name,
        })
      : writeRefusal(error);
  }
  if (failure) {
    // Still undoable once the cause is fixed, for the time it has left.
    returnRemovedEntry(held);
    return failure.response();
  }
  return overviewResponse(agentDir, project, { restored: server });
}

/**
 * Signs out of a server as `pi mcp logout` does: deletes its URL's tokens and
 * client registration from `mcp-auth.json` (`lib/mcp-sign-in.ts`), after
 * barring every sign-in run of the URL from writing there again and
 * cancelling the one under way. The URL is read from the entry's file, never
 * taken from the browser, under the checks of any change to that entry: a
 * project entry is a repository's, so its folder must be trusted. What
 * connections found before is forgotten, since signed-out ones no longer see
 * it; open sessions lose access at their next request to the server.
 */
async function signOutServer(agentDir: string, project: Project | undefined, internals: PiSdkInternals, server: McpServerRef) {
  const target = writeTarget(server.scope, project, agentDir);
  if (target instanceof Refusal) return target.response();
  const { name } = server;
  const read = readMcpServerEntry({ agentDir, scope: server.scope, name, project });
  if (!read.ok) {
    const params = { path: read.path, ...(read.reason === "server-missing" ? { name } : {}) };
    if (read.reason === "unreadable") return refusal(500, "internal", read.error, params);
    return refusal(409, read.reason, read.error, params);
  }
  if (!isRecord(read.value)) {
    return refusal(409, "entry-not-object", `${read.sourcePath} defines MCP server "${name}" as something other than an object`, { name });
  }
  const config = internals.validateMcpServerConfig(name, read.value);
  if (typeof config === "string") return refusal(409, "server-invalid", config, { name });
  const url = mcpOAuthUrl(config);
  if (url === undefined) {
    return refusal(409, "sign-in-not-oauth", `MCP server "${name}" does not use OAuth: only an HTTP server without an Authorization header does`, { name });
  }
  const removed = signOutMcpServer(name, url, agentDir, internals);
  forgetMcpEntryStatuses({ scope: server.scope, sourcePath: read.sourcePath, name });
  return overviewResponse(agentDir, project, { signedOut: { ...server, removed } });
}

/** The names a file defines now, for a name the add must not take; empty when the file cannot be listed (the write then says why). */
function namesInFile(agentDir: string, project: Project | undefined, scope: McpScope, internals: PiSdkInternals): string[] {
  try {
    const { servers } = readMcpServerConfigs({ agentDir, project: scope === "project" ? project : undefined, internals });
    return servers.filter((server) => server.scope === scope).map((server) => server.name);
  } catch {
    return [];
  }
}

function addRefusal({ status, reason, error, name, suggestedName, notes, names, fields }: McpAddRefusal): Refusal {
  return new Refusal(status, reason, error, {
    ...(name !== undefined ? { name } : {}),
    ...(suggestedName !== undefined ? { suggestedName } : {}),
    ...(notes ? { notes } : {}),
    ...(names ? { names } : {}),
    ...(fields ? { fields } : {}),
  });
}

/** A failed insert as the add answers it: a name taken meanwhile gets a free one to suggest. */
function insertRefusal(error: unknown, agentDir: string, project: Project | undefined, scope: McpScope, internals: PiSdkInternals): Refusal {
  if (isMcpConfigWriteError(error) && error.reason === "name-taken" && error.serverName !== undefined) {
    const suggestedName = suggestFreeName(error.serverName, namesInFile(agentDir, project, scope, internals));
    return new Refusal(409, "name-taken", error.message, { path: error.path, name: error.serverName, suggestedName });
  }
  return writeRefusal(error);
}

function readAddRequest(body: Record<string, unknown>): McpAddRequest | Refusal {
  const scope = readScope(body.scope);
  const values = readMcpAddValues(body.values);
  const secretReferences = readMcpAddSecretReferences(body.secretReferences);
  const server = body.server === undefined ? 0 : body.server;
  const confirm = body.confirmHostEnv === undefined ? [] : body.confirmHostEnv;
  if (
    typeof body.text !== "string" || body.text.length > MCP_ADD_MAX_TEXT || !scope || !values || !secretReferences
    || typeof server !== "number" || !Number.isInteger(server) || server < 0
    || (body.name !== undefined && readName(body.name) === undefined)
    || (body.rawPi !== undefined && typeof body.rawPi !== "boolean")
    || (body.trustFolder !== undefined && typeof body.trustFolder !== "boolean")
    || !Array.isArray(confirm) || confirm.length > 100 || !confirm.every((name) => typeof name === "string")
  ) {
    return new Refusal(400, "invalid-request", `add needs text (at most ${MCP_ADD_MAX_TEXT} characters), scope, and optionally values, secretReferences, server, name, rawPi, trustFolder and confirmHostEnv`);
  }
  return {
    text: body.text,
    values,
    secretReferences,
    server,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    scope,
    rawPi: body.rawPi === true,
    confirmHostEnv: confirm as string[],
  };
}

/** The folder's trust for the page after a project write: `.pi/mcp.json` alone makes it require trust. */
function trustAfterWrite(cwd: string, agentDir: string): ProjectTrustStatus | undefined {
  try {
    const status = getProjectTrustStatus(cwd, agentDir);
    return status.decisionError === undefined ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adds a pasted server: `prepareMcpAdd()` parses the text again, fills in the
 * values and checks the result; then it is appended to its file through the
 * writer, under the file's lock, which refuses a name taken meanwhile. A
 * project server goes only to a folder a decision trusts (the rule of every
 * project write), except with `trustFolder` for a fresh folder, which
 * `trustFreshFolderAndWrite()` trusts first and then writes, as one step.
 */
async function addServer(
  agentDir: string,
  project: Project | undefined,
  internals: PiSdkInternals,
  body: Record<string, unknown>,
) {
  const request = readAddRequest(body);
  if (request instanceof Refusal) return request.response();
  const { scope } = request;
  if (scope === "project" && !project) return refusal(400, "invalid-request", "A project server needs the project's cwd");
  const trustFolder = scope === "project" && body.trustFolder === true && project !== undefined;
  // Where it may go is said first: a confirmation asked for a server the folder then refuses would be asked for nothing.
  const target = trustFolder ? undefined : writeTarget(scope, project, agentDir);
  if (target instanceof Refusal) return target.response();
  if (trustFolder && project) {
    const breadth = freshFolderTrustBreadth(project.cwd, { agentDir, knownFolders: project.allowedRoots });
    if (breadth) return refusal(409, "trust-too-broad", `Trusting ${project.cwd} would also trust ${breadth.path}`, { breadth });
  }
  const prepared = prepareMcpAdd(request, { takenNames: namesInFile(agentDir, project, scope, internals), internals });
  if (!prepared.ok) return addRefusal(prepared).response();
  const { name, entry } = prepared;

  if (trustFolder && project) {
    const target = { scope: "project" as const, cwd: project.cwd, allowedRoots: project.allowedRoots };
    const result = await trustFreshFolderAndWrite(
      project.cwd,
      agentDir,
      () => insertMcpServer(target, name, entry),
      { knownFolders: project.allowedRoots },
    );
    if (!result.ok) {
      switch (result.reason) {
        case "trust-too-broad":
          return refusal(409, "trust-too-broad", result.error, { breadth: result.breadth });
        case "folder-not-fresh":
          return refusal(409, "folder-not-fresh", result.error, result.status ? { trust: result.status } : {});
        case "trust-unreadable":
          return refusal(409, "trust-unreadable", result.error);
        case "write-failed": {
          const failure = insertRefusal(result.writeError, agentDir, project, scope, internals);
          if (result.rollbackError === undefined) return failure.response();
          // The write's own reason still says why nothing was added; `trustKept` says the folder stays trusted.
          return refusal(failure.status, failure.reason, `${failure.error}; the folder stays trusted, since taking the trust back failed: ${result.rollbackError}`, {
            ...failure.params,
            trustKept: true,
            ...(result.status ? { trust: result.status } : {}),
          });
        }
      }
    }
    invalidateModelsCache();
    return overviewResponse(agentDir, project, {
      added: { scope, name, path: result.value.path },
      trust: result.status,
      trustedFolder: true,
    });
  }

  if (!target) return refusal(500, "internal", "No file to write to");
  let path: string;
  try {
    ({ path } = await insertMcpServer(target, name, entry));
  } catch (error) {
    return insertRefusal(error, agentDir, project, scope, internals).response();
  }
  const trust = scope === "project" && project ? trustAfterWrite(project.cwd, agentDir) : undefined;
  return overviewResponse(agentDir, project, { added: { scope, name, path }, ...(trust ? { trust } : {}) });
}

// POST /api/mcp body: { action, cwd?, ... }
//   enable | disable | remove | sign-out: { scope, name }
//   set-enabled: { enabled, servers: [{ scope, name }] } → per-server `results`
//   set-exposure: { scope, name, exposure }
//   undo: { token } (from a remove's `undo`)
//   add: { text, scope, values?, secretReferences?, server?, name?, rawPi?, trustFolder?, confirmHostEnv? }
// `cwd` is the panel's project: required for a project server, and the
// overview in the answer covers it.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "content-type", "Content-Type must be application/json");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  if (!isRecord(body)) return refusal(400, "invalid-request", "Expected a JSON object");

  let project: Project | undefined;
  if (body.cwd !== undefined && body.cwd !== null) {
    const result = await validateProject(body.cwd);
    if (result instanceof Refusal) return result.response();
    project = result;
  }

  const internals = await mcpWritable();
  if (internals instanceof Refusal) return internals.response();
  const agentDir = getAgentDir();

  try {
    switch (body.action) {
      case "enable":
      case "disable":
      case "remove":
      case "sign-out": {
        const scope = readScope(body.scope);
        const name = readName(body.name);
        if (!scope || name === undefined) return refusal(400, "invalid-request", "scope must be \"global\" or \"project\", and name a server name");
        if (body.action === "remove") return await removeServer(agentDir, project, { scope, name });
        if (body.action === "sign-out") return await signOutServer(agentDir, project, internals, { scope, name });
        return await switchServer(agentDir, project, internals, { scope, name }, body.action === "enable");
      }
      case "set-enabled": {
        const servers = readServerList(body.servers);
        if (typeof body.enabled !== "boolean" || !servers) {
          return refusal(400, "invalid-request", `enabled must be a boolean, and servers a list of 1 to ${MAX_BULK_SERVERS} { scope, name }`);
        }
        return await switchServers(agentDir, project, internals, servers, body.enabled);
      }
      case "set-exposure": {
        const scope = readScope(body.scope);
        const name = readName(body.name);
        if (!scope || name === undefined || !isMcpExposure(body.exposure)) {
          return refusal(400, "invalid-request", `scope must be "global" or "project", name a server name, and exposure one of ${MCP_EXPOSURES.join(", ")}`);
        }
        return await setServerExposure(agentDir, project, { scope, name }, body.exposure);
      }
      case "undo": {
        if (typeof body.token !== "string" || body.token.length === 0 || body.token.length > 100) {
          return refusal(400, "invalid-request", "token must be the token a remove answered with");
        }
        return await undoRemoval(agentDir, project, body.token);
      }
      case "add":
        return await addServer(agentDir, project, internals, body);
      default:
        return refusal(400, "invalid-request", "action must be add, enable, disable, remove, set-enabled, set-exposure, undo or sign-out");
    }
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}
