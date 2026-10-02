import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpRefusalReason, McpScope } from "./api-types";
import {
  fillMcpImportFields,
  isValidServerName,
  type McpImportFieldValue,
  type McpImportNote,
  parseMcpImport,
  suggestFreeName,
} from "./mcp-import";
import { findWebPasswordField, resolvedConfigValues } from "./mcp-transport";
import type { PiSdkInternals } from "./pi-sdk-internals";

// What `POST /api/mcp { action: "add" }` checks before it writes anything
// (ADR 0006, "Adding is one paste box"). The browser sends the pasted text and
// the values it filled in, never a config: the text is parsed again here by
// the same pure importer the panel previewed it with, so what is written is
// what the importer makes of the text, escaping included, and the browser
// cannot slip in a key the importer would have dropped.

/** The largest paste the route reads; a whole `mcp.json` of many servers fits easily. */
export const MCP_ADD_MAX_TEXT = 256 * 1024;

export interface McpAddRequest {
  text: string;
  /** Field values by field id: the text, or `{ reference }` for a `${NAME}` instead. */
  values: Record<string, McpImportFieldValue>;
  /** The paste's own literal secrets to store as `${NAME}` instead, by label (`headers.Authorization`): the way into a project (ADR 0006, "Secrets typed in the panel"). */
  secretReferences?: Record<string, string>;
  /** Which of the paste's servers, in the importer's order. */
  server: number;
  /** The name to save it under; the importer's name when absent. */
  name?: string;
  scope: McpScope;
  /** Take JSON values as pi syntax (`${VAR}`, `$$`, `!command` kept as written). */
  rawPi: boolean;
  /** The host variables the user agreed to send (`host-env-confirm`). */
  confirmHostEnv: string[];
}

export interface McpAddRefusal {
  ok: false;
  status: number;
  reason: McpRefusalReason;
  error: string;
  name?: string;
  suggestedName?: string;
  notes?: McpImportNote[];
  names?: string[];
  fields?: string[];
}

export interface McpAddPrepared {
  ok: true;
  name: string;
  /** The entry to write: the importer's fresh object with the values filled in. */
  entry: McpServerConfig;
}

type AddInternals = Pick<PiSdkInternals, "validateMcpServerConfig" | "getConfigValueEnvVarNames" | "isCommandConfigValue">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_FIELD_VALUE = 64 * 1024;
const MAX_FIELDS = 200;

/** Reads the request's `values`: field ids to text, or to `{ reference: NAME }`; anything else is not a request. */
export function readMcpAddValues(value: unknown): Record<string, McpImportFieldValue> | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS) return undefined;
  const values: Record<string, McpImportFieldValue> = {};
  for (const [id, given] of entries) {
    if (typeof given === "string") {
      if (given.length > MAX_FIELD_VALUE) return undefined;
      Object.defineProperty(values, id, { value: given, enumerable: true, writable: true, configurable: true });
    } else if (isRecord(given) && typeof given.reference === "string" && given.reference.length <= 256) {
      Object.defineProperty(values, id, { value: { reference: given.reference }, enumerable: true, writable: true, configurable: true });
    } else {
      return undefined;
    }
  }
  return values;
}

/** Reads the request's `secretReferences`: secret labels to the variable names typed for them; anything else is not a request. */
export function readMcpAddSecretReferences(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS) return undefined;
  const references: Record<string, string> = {};
  for (const [label, name] of entries) {
    if (typeof name !== "string" || name.length > 256) return undefined;
    Object.defineProperty(references, label, { value: name, enumerable: true, writable: true, configurable: true });
  }
  return references;
}

/** The host variables the user chose by name, for a field or for one of the paste's secrets. */
function chosenVariableNames(request: Pick<McpAddRequest, "values" | "secretReferences">): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(request.values)) {
    if (typeof value === "object") names.add(value.reference.trim());
  }
  for (const name of Object.values(request.secretReferences ?? {})) names.add(name.trim());
  return names;
}

/**
 * The variables of the Pi Web host a server would be sent: the `${NAME}` /
 * `$NAME` references in an HTTP entry's header values and `oauth.clientSecret`,
 * which pi resolves from the whole `process.env` of the process connecting it,
 * for those names set there. A stdio entry's `env` stays on this computer, in
 * the process it starts, and is not counted. `PI_WEB_PASSWORD` is not counted
 * either: such an entry is refused outright.
 */
export function mcpHostEnvNames(
  config: McpServerConfig,
  internals: Pick<PiSdkInternals, "getConfigValueEnvVarNames" | "isCommandConfigValue">,
  environment: NodeJS.ProcessEnv,
): string[] {
  const names: string[] = [];
  for (const { kind, value } of resolvedConfigValues(config)) {
    if (kind === "env" || internals.isCommandConfigValue(value)) continue;
    for (const name of internals.getConfigValueEnvVarNames(value)) {
      if (name.toUpperCase() === "PI_WEB_PASSWORD") continue;
      if (environment[name] !== undefined && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Turns an add request into the entry to write, or the typed refusal the
 * route answers with, in this order:
 * - the text is parsed (`import-failed` with the importer's notes) and the
 *   server picked (`invalid-request`);
 * - the name must be one pi accepts (`name-invalid`) and not taken in the
 *   file it goes to (`name-taken`, with a free `suggestedName`; the write
 *   checks again under the file's lock);
 * - the values are filled in, escaped as any literal, and the paste's own
 *   secrets the user chose to read from a variable stored as `${NAME}`
 *   (`fields-incomplete`, with the importer's notes);
 * - the SDK's validator must accept the result (`server-invalid`), and it may
 *   not reference `PI_WEB_PASSWORD` (`web-password`);
 * - a literal secret keeps it global (`secret-global-only`, with the fields):
 *   a project file is often committed;
 * - a non-pi paste whose headers or client secret read variables set on this
 *   host needs those names confirmed (`host-env-confirm`, with the names):
 *   pi sends their values to the server's URL. Variables the user named
 *   (for a field, or for one of the paste's secrets) are theirs and not asked
 *   about.
 */
export function prepareMcpAdd(
  request: McpAddRequest,
  options: { takenNames: readonly string[]; internals: AddInternals; environment?: NodeJS.ProcessEnv },
): McpAddPrepared | McpAddRefusal {
  const { takenNames, internals, environment = process.env } = options;
  const parsed = parseMcpImport(request.text, { rawPi: request.rawPi, takenNames });
  if (!parsed.ok) {
    return { ok: false, status: 400, reason: "import-failed", error: "No MCP server could be read from the pasted text", notes: parsed.notes };
  }
  const server = parsed.servers[request.server];
  if (!server) {
    return { ok: false, status: 400, reason: "invalid-request", error: `The pasted text holds ${parsed.servers.length} server(s); there is no server ${request.server}` };
  }
  const name = request.name ?? server.name;
  if (!isValidServerName(name)) {
    return { ok: false, status: 400, reason: "name-invalid", error: `"${name}" is not a server name pi accepts: use letters, digits, "_" and "-"`, name };
  }
  if (takenNames.includes(name)) {
    return {
      ok: false,
      status: 409,
      reason: "name-taken",
      error: `The file already defines MCP server "${name}"`,
      name,
      suggestedName: suggestFreeName(name, takenNames),
    };
  }
  const filled = fillMcpImportFields(server, request.values, request.secretReferences);
  if (!filled.ok) {
    return { ok: false, status: 400, reason: "fields-incomplete", error: "Some values to fill in are missing or invalid", notes: filled.notes };
  }
  const validated = internals.validateMcpServerConfig(name, filled.config);
  if (typeof validated === "string") return { ok: false, status: 409, reason: "server-invalid", error: validated, name };
  if (findWebPasswordField(filled.config, internals)) {
    return { ok: false, status: 409, reason: "web-password", error: `"${name}" references PI_WEB_PASSWORD, so Pi Web does not add it`, name };
  }
  if (request.scope === "project" && filled.secretPaths.length > 0) {
    return {
      ok: false,
      status: 409,
      reason: "secret-global-only",
      error: `"${name}" holds a literal secret (${filled.secretPaths.join(", ")}), so it is saved only in the global mcp.json`,
      name,
      fields: filled.secretPaths,
    };
  }
  if (!server.rawPi) {
    const chosen = chosenVariableNames(request);
    const names = mcpHostEnvNames(filled.config, internals, environment).filter((variable) => !chosen.has(variable));
    const unconfirmed = names.filter((variable) => !request.confirmHostEnv.includes(variable));
    if (unconfirmed.length > 0) {
      return {
        ok: false,
        status: 409,
        reason: "host-env-confirm",
        error: `"${name}" would send these variables of the Pi Web host to its server: ${names.join(", ")}`,
        name,
        names,
      };
    }
  }
  return { ok: true, name, entry: filled.config };
}
