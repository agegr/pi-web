import {
  GEMINI_GRAMMAR,
  isLoopbackRedirectUri,
  LITERAL_GRAMMAR,
  type McpImportFormat,
  type McpImportNote,
  nameFromPackage,
  OPENCODE_GRAMMAR,
  parseValue,
  resolveMcpExposure,
  type Segment,
  ServerDraft,
  setLiteralUrl,
  sourceText,
  timeoutFromMilliseconds,
  timeoutFromSeconds,
  timeoutGuessingUnit,
  UNION_GRAMMAR,
  type ValueGrammar,
  type VsCodeInput,
} from "./mcp-import-core";
import { isSecretName } from "./mcp-secrets";
import { literalWord, splitShellWords } from "./shell-words";

// JSON shapes of other MCP clients, mapped onto pi's schema: the `mcpServers`
// family (Claude Desktop and Code, Cursor, Windsurf, Cline, Gemini, Copilot,
// pi itself), VS Code (`servers` + `inputs`), Zed (`context_servers`),
// opencode (`mcp`), single server objects and maps of them, and an MCP
// registry `server.json`. Only known keys are read; every other key is
// dropped with a note, so nothing unknown reaches mcp.json.

export type EntryFlavor = "mcp-servers" | "vscode" | "zed" | "opencode";

export interface EntryContext {
  source: McpImportFormat;
  flavor: EntryFlavor;
  /** Values are pi syntax (the "this is a pi config" toggle). */
  rawPi: boolean;
  inputs?: Map<string, VsCodeInput>;
}

/** A server read from the paste, or the note that says why it is not one. */
export type EntryOutcome = { draft: ServerDraft } | { note: McpImportNote };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys that only Gemini's `settings.json` uses; its `$NAME` is a reference, unlike Claude's. */
const GEMINI_KEYS = ["httpUrl", "trust", "includeTools", "excludeTools", "authProviderType", "targetAudience", "targetServiceAccount", "tcp"];

/** Keys only Cline (and its fork Roo Code) write; their `timeout` is in seconds. */
function isClineEntry(entry: Record<string, unknown>): boolean {
  return ["autoApprove", "alwaysAllow", "transportType"].some((key) => key in entry) || entry.type === "streamableHttp";
}

function isGeminiEntry(entry: Record<string, unknown>): boolean {
  if (GEMINI_KEYS.some((key) => key in entry)) return true;
  const oauth = entry.oauth;
  return isRecord(oauth) && ["redirectUri", "authorizationUrl", "tokenUrl", "audiences", "tokenParamName"].some((key) => key in oauth);
}

/** Whether a JSON value looks like one server entry of any client. */
export function looksLikeServer(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const { command, url, serverUrl, httpUrl } = value;
  return (typeof command === "string" && command !== "")
    || (Array.isArray(command) && typeof command[0] === "string")
    || (isRecord(command) && typeof command.path === "string")
    || typeof url === "string"
    || typeof serverUrl === "string"
    || typeof httpUrl === "string";
}

function grammarFor(context: EntryContext, entry: Record<string, unknown>): ValueGrammar {
  switch (context.flavor) {
    case "zed":
      return LITERAL_GRAMMAR;
    case "opencode":
      return OPENCODE_GRAMMAR;
    case "vscode":
      return UNION_GRAMMAR;
    default:
      return isGeminiEntry(entry) ? GEMINI_GRAMMAR : UNION_GRAMMAR;
  }
}

type Transport = "stdio" | "http" | "sse" | "ws" | "unknown";

function readType(type: string): Transport {
  switch (type.toLowerCase().replace(/[-_]/g, "")) {
    case "stdio":
    case "local":
      return "stdio";
    case "http":
    case "streamablehttp":
    case "remote":
      return "http";
    case "sse":
      return "sse";
    case "ws":
    case "wss":
    case "websocket":
      return "ws";
    default:
      return "unknown";
  }
}

/** The streamable HTTP address next to a legacy `/sse` one (`…/sse` → `…/mcp`), which the test then confirms. */
export function siblingMcpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/\/sse\/?$/.test(parsed.pathname)) return undefined;
    parsed.pathname = parsed.pathname.replace(/\/sse\/?$/, "/mcp");
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function sseRefusal(server: string | undefined, url: string | undefined): McpImportNote {
  const suggestedUrl = url ? siblingMcpUrl(url) : undefined;
  return {
    code: "sse-transport",
    params: {
      ...(server ? { server } : {}),
      ...(url ? { url } : {}),
      ...(suggestedUrl ? { suggestedUrl } : {}),
    },
  };
}

function serverParam(name: string | undefined): Record<string, string> {
  return name ? { server: name } : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * Maps one server entry onto a draft. `name` is the key it was listed under;
 * a string `name` inside the entry (VS Code install JSON) is used when there
 * is none.
 */
export function mapServerEntry(name: string | undefined, entry: unknown, context: EntryContext): EntryOutcome {
  if (!isRecord(entry)) return { note: { code: "no-command-or-url", params: serverParam(name) } };
  const used = new Set<string>();
  const take = (key: string): unknown => {
    used.add(key);
    return entry[key];
  };
  const rawPi = context.rawPi;
  const grammar = grammarFor(context, entry);
  const ownName = take("name");
  const serverName = name ?? (typeof ownName === "string" ? ownName : undefined);
  const draft = new ServerDraft(context.source, rawPi);
  const value = (text: string, resolved: boolean): Segment[] => {
    if (rawPi) return sourceText(text, true);
    // `!command`, `$$` and `$!` mean something only in pi's own mcp.json.
    if (resolved && context.flavor === "mcp-servers" && /^!|\$\$|\$!/.test(text)) draft.note("looks-like-pi-config");
    return parseValue(text, grammar, resolved);
  };
  draft.name = serverName;
  draft.inputs = context.inputs;
  const ownInputs = take("inputs");
  if (Array.isArray(ownInputs)) draft.inputs = new Map([...(context.inputs ?? []), ...readInputs(ownInputs)]);

  // Transport.
  const rawType = take("type");
  const command = take("command");
  const urlValue = [take("httpUrl"), take("url"), take("serverUrl")].find((candidate): candidate is string => typeof candidate === "string");
  if ("tcp" in entry) return { note: { code: "websocket-transport", params: serverParam(serverName) } };
  let transport: Transport | undefined;
  if (rawType !== undefined) {
    transport = typeof rawType === "string" ? readType(rawType) : "unknown";
    if (transport === "unknown") {
      return { note: { code: "unsupported-transport", params: { ...serverParam(serverName), type: String(rawType) } } };
    }
  }
  const hasCommand = (typeof command === "string" && command !== "") || Array.isArray(command) || isRecord(command);
  const hasUrl = urlValue !== undefined;
  if (transport === "sse") return { note: sseRefusal(serverName, urlValue) };
  if (transport === "ws") return { note: { code: "websocket-transport", params: { ...serverParam(serverName), ...(urlValue ? { url: urlValue } : {}) } } };
  if (transport === undefined) {
    if (hasCommand && hasUrl) return { note: { code: "ambiguous-command-and-url", params: serverParam(serverName) } };
    if (hasUrl) {
      if (siblingMcpUrl(urlValue) !== undefined) return { note: sseRefusal(serverName, urlValue) };
      transport = "http";
      if (context.flavor === "mcp-servers" && typeof entry.url === "string" && typeof entry.httpUrl !== "string") {
        draft.note("transport-guessed");
      }
    } else if (hasCommand) {
      transport = "stdio";
    } else {
      return { note: { code: "no-command-or-url", params: serverParam(serverName) } };
    }
  }
  if (transport !== "stdio" && transport !== "http") {
    return { note: { code: "unsupported-transport", params: { ...serverParam(serverName), type: String(rawType) } } };
  }
  if ((transport === "stdio" && !hasCommand) || (transport === "http" && !hasUrl)) {
    return { note: { code: "no-command-or-url", params: serverParam(serverName) } };
  }
  draft.transport = transport;

  if (transport === "stdio") {
    const problem = mapStdio(draft, entry, command, take, value, context);
    if (problem) return { note: problem };
  } else {
    mapHttp(draft, entry, urlValue!, take, value);
  }

  // Options both transports share.
  const timeout = take("timeout");
  if (timeout !== undefined) {
    if (rawPi) {
      if (typeof timeout === "number" && timeout > 0) draft.timeout = timeout;
      else draft.note("timeout-dropped", { value: String(timeout) });
    } else if (context.flavor === "opencode") {
      // opencode's timeout bounds fetching the tool list, not each request.
      draft.note("timeout-dropped", { value: String(timeout) });
    } else if (isGeminiEntry(entry)) {
      timeoutFromMilliseconds(draft, timeout);
    } else if (isClineEntry(entry)) {
      timeoutFromSeconds(draft, timeout);
    } else {
      timeoutGuessingUnit(draft, timeout);
    }
  }
  const enabled = take("enabled");
  const disabled = take("disabled");
  if (enabled === false || disabled === true) {
    draft.enabled = false;
    draft.note("imported-disabled");
  } else if ((enabled !== undefined && typeof enabled !== "boolean") || (disabled !== undefined && typeof disabled !== "boolean")) {
    draft.note("dropped-key", { key: enabled !== undefined ? "enabled" : "disabled" });
  }
  // An old exposure name pi still accepts (`codemode-deferred`) is written as what it now means.
  const exposure = take("exposure");
  if (exposure !== undefined) {
    const resolved = resolveMcpExposure(exposure);
    if (resolved) draft.exposure = resolved;
    else draft.note("invalid-exposure-dropped", { value: String(exposure) });
  }
  const toolExposure = take("toolExposure");
  if (toolExposure !== undefined) {
    const resolved = isRecord(toolExposure)
      ? Object.entries(toolExposure).map(([tool, value]) => [tool, resolveMcpExposure(value)] as const)
      : undefined;
    if (resolved?.every(([, value]) => value !== undefined)) {
      draft.toolExposure = Object.fromEntries(resolved) as Record<string, NonNullable<ServerDraft["exposure"]>>;
    } else {
      draft.note("invalid-exposure-dropped", { value: "toolExposure" });
    }
  }
  if (!rawPi && (exposure !== undefined || toolExposure !== undefined)) draft.note("looks-like-pi-config");
  // pi lists the server with its description in the system prompt. Only pi syntax, which the
  // user writes, carries it: another client's text would reach the prompt unseen in the preview.
  if (rawPi) {
    const description = take("description");
    if (typeof description === "string") draft.description = description;
    else if (description !== undefined) draft.note("dropped-key", { key: "description" });
  }
  mapToolFilters(draft, take("includeTools"), take("excludeTools"));

  for (const key of Object.keys(entry)) {
    if (!used.has(key)) draft.note("dropped-key", { key });
  }
  return { draft };
}

type Take = (key: string) => unknown;
type ValueOf = (text: string, resolved: boolean) => Segment[];

function mapStdio(
  draft: ServerDraft,
  entry: Record<string, unknown>,
  command: unknown,
  take: Take,
  value: ValueOf,
  context: EntryContext,
): McpImportNote | undefined {
  let commandText: string | undefined;
  let args: unknown = take("args");
  let env: unknown = context.flavor === "opencode" ? take("environment") : take("env");
  if (context.flavor === "opencode" && env === undefined) env = take("env");
  if (Array.isArray(command)) {
    // opencode: the command and its arguments in one array.
    if (!command.every((word) => typeof word === "string") || command.length === 0) {
      return { code: "invalid-config", params: { ...serverParam(draft.name), problem: "args" } };
    }
    commandText = command[0];
    args = [...command.slice(1), ...(Array.isArray(args) ? args : [])];
  } else if (isRecord(command)) {
    // Zed's older `"command": { "path", "args", "env" }`.
    commandText = typeof command.path === "string" ? command.path : undefined;
    if (args === undefined) args = command.args;
    if (env === undefined) env = command.env;
    for (const key of Object.keys(command)) {
      if (!["path", "args", "env"].includes(key)) draft.note("dropped-key", { key: `command.${key}` });
    }
  } else if (typeof command === "string") {
    commandText = command;
  }
  if (!commandText) return { code: "no-command-or-url", params: serverParam(draft.name) };

  const argList: unknown[] = Array.isArray(args) ? [...args] : [];
  if (args !== undefined && !Array.isArray(args)) return { code: "invalid-config", params: { ...serverParam(draft.name), problem: "args" } };
  if (argList.length === 0 && /\s/.test(commandText.trim()) && !/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])/.test(commandText.trim())) {
    // Cursor install links put a whole command line into `command`.
    const split = splitShellWords(commandText.trim());
    const words = split.ok ? split.words.map(literalWord) : undefined;
    if (words && words.length > 1 && words.every((word): word is string => word !== undefined)) {
      draft.note("command-split", { command: commandText });
      commandText = words[0];
      argList.push(...words.slice(1));
    }
  }
  draft.command = value(commandText, false);
  for (const [index, arg] of argList.entries()) {
    const text = asString(arg);
    if (text === undefined) return { code: "invalid-config", params: { ...serverParam(draft.name), problem: "args", index } };
    draft.args.push(value(text, false));
  }
  if (env !== undefined) {
    if (!isRecord(env)) return { code: "invalid-config", params: { ...serverParam(draft.name), problem: "env" } };
    for (const [key, raw] of Object.entries(env)) {
      if (raw === null) {
        // VS Code unsets an inherited variable with null; pi cannot.
        draft.note("env-null-dropped", { name: key });
        continue;
      }
      const text = asString(raw);
      if (text === undefined) {
        draft.note("dropped-key", { key: `env.${key}` });
        continue;
      }
      if (typeof raw !== "string") draft.note("env-value-stringified", { name: key });
      if (text === "" && isSecretName(key)) {
        draft.env.push([key, [{ kind: "prompt", id: `env.${key}`, reason: "empty", label: key, from: "", secret: true }]]);
        continue;
      }
      draft.env.push([key, value(text, true)]);
    }
  }
  const cwd = take("cwd");
  if (typeof cwd === "string" && cwd !== "") draft.cwd = value(cwd, false);
  else if (cwd !== undefined && cwd !== "") draft.note("dropped-key", { key: "cwd" });
  for (const key of ["headers", "oauth", "auth", "url", "httpUrl", "serverUrl"]) {
    if (key in entry) {
      take(key);
      draft.note("dropped-key", { key });
    }
  }
  return undefined;
}

function mapHttp(draft: ServerDraft, entry: Record<string, unknown>, url: string, take: Take, value: ValueOf): void {
  const headers = take("headers");
  const urlSegments = value(url, false);
  const hasAuthorization = isRecord(headers) && Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
  if (urlSegments.length === 1 && "text" in urlSegments[0]) setLiteralUrl(draft, url, hasAuthorization);
  else draft.url = urlSegments;
  if (isRecord(headers)) {
    for (const [key, raw] of Object.entries(headers)) {
      const text = asString(raw);
      if (text === undefined) {
        draft.note("dropped-key", { key: `headers.${key}` });
        continue;
      }
      if (text.trim() === "") {
        if (key.toLowerCase() === "authorization") {
          // An empty Authorization header is still sent, and it turns OAuth off.
          draft.note("empty-authorization-dropped");
        } else if (isSecretName(key)) {
          draft.headers.push([key, [{ kind: "prompt", id: `headers.${key}`, reason: "empty", label: key, from: "", secret: true, optional: true }]]);
        } else {
          draft.headers.push([key, []]);
        }
        continue;
      }
      draft.headers.push([key, value(text, true)]);
    }
  } else if (headers !== undefined) {
    draft.note("dropped-key", { key: "headers" });
  }

  const oauth = take("oauth");
  const auth = take("auth");
  if (oauth === false) draft.note("oauth-disable-unsupported");
  else if (isRecord(oauth)) mapOAuth(draft, oauth, value);
  else if (oauth !== undefined) draft.note("dropped-key", { key: "oauth" });
  if (isRecord(auth)) {
    // Cursor: { CLIENT_ID, CLIENT_SECRET, scopes }.
    mapOAuth(draft, {
      ...(auth.CLIENT_ID !== undefined ? { clientId: auth.CLIENT_ID } : {}),
      ...(auth.CLIENT_SECRET !== undefined ? { clientSecret: auth.CLIENT_SECRET } : {}),
      ...(auth.scopes !== undefined ? { scopes: auth.scopes } : {}),
    }, value, "auth.");
    for (const key of Object.keys(auth)) {
      if (!["CLIENT_ID", "CLIENT_SECRET", "scopes"].includes(key)) draft.note("oauth-option-dropped", { key: `auth.${key}` });
    }
  } else if (auth !== undefined) {
    draft.note("dropped-key", { key: "auth" });
  }
  for (const key of ["command", "args", "env", "environment", "cwd"]) {
    if (key in entry) {
      take(key);
      draft.note("dropped-key", { key });
    }
  }
}

function mapOAuth(draft: ServerDraft, oauth: Record<string, unknown>, value: ValueOf, prefix = "oauth."): void {
  for (const [key, raw] of Object.entries(oauth)) {
    switch (key) {
      case "clientId":
        if (typeof raw === "string" && raw !== "") draft.oauth.clientId = value(raw, false);
        break;
      case "clientSecret":
        if (typeof raw === "string" && raw !== "") draft.oauth.clientSecret = value(raw, true);
        break;
      case "callbackPort":
        if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 65535) draft.oauth.callbackPort = raw;
        else draft.note("callback-port-dropped", { value: String(raw) });
        break;
      case "clientName":
        if (typeof raw === "string" && raw.trim()) draft.oauth.clientName = value(raw, false);
        else draft.note("oauth-option-dropped", { key: `${prefix}${key}` });
        break;
      case "authServerMetadataUrl":
        // pi checks it is https (or http on a loopback host); validation says so when it is not.
        if (typeof raw === "string" && raw !== "") draft.oauth.authServerMetadataUrl = value(raw, false);
        else draft.note("oauth-option-dropped", { key: `${prefix}${key}` });
        break;
      case "callbackUrl":
      case "redirectUri":
        if (typeof raw === "string" && isLoopbackRedirectUri(raw)) draft.oauth.callbackUrl = value(raw, false);
        else draft.note("callback-url-dropped", { value: String(raw) });
        break;
      case "scope":
      case "scopes": {
        const scope = Array.isArray(raw) ? raw.filter((item) => typeof item === "string").join(" ") : typeof raw === "string" ? raw : "";
        if (scope) draft.oauth.scope = value(scope, false);
        break;
      }
      case "enabled":
        // Gemini's switch for OAuth; pi uses OAuth whenever no Authorization header is set.
        if (raw === false) draft.note("oauth-disable-unsupported");
        break;
      default:
        draft.note("oauth-option-dropped", { key: `${prefix}${key}` });
    }
  }
  const { callbackPort, callbackUrl } = draft.oauth;
  if (callbackPort !== undefined && callbackUrl) {
    const text = callbackUrl.map((segment) => ("text" in segment ? segment.text : "")).join("");
    let urlPort = "";
    try {
      urlPort = new URL(text).port;
    } catch {
      // Not a URL once placeholders are filled in; validation reports it.
    }
    if (urlPort && Number(urlPort) !== callbackPort) {
      draft.note("callback-url-dropped", { value: text });
      draft.oauth.callbackUrl = undefined;
    }
  }
}

/** Gemini's `includeTools` / `excludeTools` as pi's `toolExposure`, so an exclusion keeps those tools out. */
export function mapToolFilters(draft: ServerDraft, include: unknown, exclude: unknown): void {
  const names = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item !== "") : []);
  const included = names(include);
  const excluded = names(exclude);
  if (included.length === 0 && excluded.length === 0) return;
  const toolExposure: Record<string, NonNullable<ServerDraft["exposure"]>> = { ...(draft.toolExposure ?? {}) };
  if (included.length > 0) {
    const base = draft.exposure ?? "codemode";
    draft.exposure = "hidden";
    for (const tool of included) toolExposure[tool] = base;
    draft.note("tool-filter-imported", { mode: "include", tools: included.join(", ") });
  }
  for (const tool of excluded) toolExposure[tool] = "hidden";
  if (excluded.length > 0) draft.note("tool-filter-imported", { mode: "exclude", tools: excluded.join(", ") });
  draft.toolExposure = toolExposure;
}

/** VS Code `inputs`, by id. */
export function readInputs(inputs: unknown): Map<string, VsCodeInput> {
  const map = new Map<string, VsCodeInput>();
  if (!Array.isArray(inputs)) return map;
  for (const input of inputs) {
    if (!isRecord(input) || typeof input.id !== "string") continue;
    map.set(input.id, {
      id: input.id,
      ...(typeof input.type === "string" ? { type: input.type } : {}),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(input.password === true ? { password: true } : {}),
      ...(typeof input.default === "string" ? { default: input.default } : {}),
      ...(Array.isArray(input.options)
        ? { options: input.options.map((option) => (isRecord(option) ? option.value : option)).filter((option): option is string => typeof option === "string") }
        : {}),
    });
  }
  return map;
}

export type JsonServers = { entries: EntryOutcome[]; notes: McpImportNote[] } | { error: McpImportNote };

/** Every server in a parsed JSON paste, in the order they appear. */
export function readJsonServers(value: unknown, rawPi: boolean): JsonServers {
  const notes: McpImportNote[] = [];
  const mapAll = (servers: Record<string, unknown>, context: EntryContext) => (
    Object.entries(servers).map(([name, entry]) => mapServerEntry(name, entry, context))
  );
  if (Array.isArray(value)) {
    const servers = value.filter(looksLikeServer);
    if (servers.length === 0) return { error: { code: "no-servers-found" } };
    return {
      entries: servers.map((entry) => mapServerEntry(undefined, entry, { source: "server-object", flavor: "mcp-servers", rawPi })),
      notes,
    };
  }
  if (!isRecord(value)) return { error: { code: "no-servers-found" } };

  const registry = isRecord(value.server) && (Array.isArray(value.server.remotes) || Array.isArray(value.server.packages))
    ? value.server
    : Array.isArray(value.remotes) || Array.isArray(value.packages) ? value : undefined;
  if (registry) return { entries: readRegistryServer(registry), notes };

  if (isRecord(value.mcpServers)) {
    if (typeof value.autoEnableCodemode === "boolean" && !rawPi) notes.push({ code: "looks-like-pi-config" });
    return { entries: mapAll(value.mcpServers, { source: "mcp-servers-json", flavor: "mcp-servers", rawPi }), notes };
  }
  if (isRecord(value.servers)) {
    const inputs = readInputs(value.inputs);
    return { entries: mapAll(value.servers, { source: "vscode-json", flavor: "vscode", rawPi: false, inputs }), notes };
  }
  if (isRecord(value.mcp)) {
    const mcp = value.mcp;
    if (isRecord(mcp.servers)) {
      // VS Code's older `"mcp": { "servers", "inputs" }` inside settings.json.
      const inputs = readInputs(mcp.inputs);
      return { entries: mapAll(mcp.servers, { source: "vscode-json", flavor: "vscode", rawPi: false, inputs }), notes };
    }
    return { entries: mapAll(mcp, { source: "opencode-json", flavor: "opencode", rawPi: false }), notes };
  }
  if (isRecord(value.context_servers)) {
    const entries = Object.entries(value.context_servers).map(([name, entry]): EntryOutcome => {
      if (isRecord(entry) && (entry.source === "extension" || !looksLikeServer(entry))) {
        return { note: { code: "zed-extension-server", params: { server: name } } };
      }
      const outcome = mapServerEntry(name, isRecord(entry) ? withoutKey(entry, "source") : entry, { source: "zed-json", flavor: "zed", rawPi: false });
      return outcome;
    });
    return { entries, notes };
  }
  if (looksLikeServer(value)) {
    return { entries: [mapServerEntry(undefined, value, { source: "server-object", flavor: "mcp-servers", rawPi })], notes };
  }
  const values = Object.values(value);
  if (values.length > 0 && values.every(isRecord) && values.some(looksLikeServer)) {
    return { entries: mapAll(value, { source: "server-map", flavor: "mcp-servers", rawPi }), notes };
  }
  return { error: { code: "no-servers-found" } };
}

function withoutKey(entry: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...entry };
  delete copy[key];
  return copy;
}

/** `{name}` variables of a registry URL or header value. */
function registryTemplate(
  text: string,
  variables: unknown,
  idPrefix: string,
  reason: "registry-variable" | "registry-header",
): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g)) {
    if (match.index! > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
    const variable = isRecord(variables) && isRecord(variables[match[1]]) ? variables[match[1]] as Record<string, unknown> : {};
    segments.push(registryPrompt(`${idPrefix}${match[1]}`, match[1], match[0], variable, reason));
    last = match.index! + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

function registryPrompt(
  id: string,
  label: string,
  from: string,
  input: Record<string, unknown>,
  reason: "registry-variable" | "registry-header",
): Segment {
  const choices = Array.isArray(input.choices) ? input.choices.filter((choice): choice is string => typeof choice === "string") : [];
  return {
    kind: "prompt",
    id,
    reason,
    label,
    from,
    secret: input.isSecret === true,
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.default === "string" ? { defaultValue: input.default } : {}),
    ...(input.isRequired === true ? {} : { optional: reason === "registry-header" }),
    ...(choices.length > 0 ? { options: choices } : {}),
  };
}

/** An MCP registry `server.json`: its streamable HTTP remotes; packages wait for registry support. */
function readRegistryServer(server: Record<string, unknown>): EntryOutcome[] {
  const fullName = typeof server.name === "string" ? server.name : "";
  const name = fullName ? nameFromPackage(fullName.split("/").pop() ?? fullName) : undefined;
  const remotes = Array.isArray(server.remotes) ? server.remotes.filter(isRecord) : [];
  const streamable = remotes.filter((remote) => typeof remote.type === "string" && readType(remote.type) === "http" && typeof remote.url === "string");
  if (streamable.length === 0) {
    const sse = remotes.find((remote) => remote.type === "sse");
    if (sse) return [{ note: sseRefusal(name, typeof sse.url === "string" ? sse.url : undefined) }];
    return [{ note: { code: "registry-packages-unsupported", params: serverParam(name) } }];
  }
  return streamable.map((remote): EntryOutcome => {
    const draft = new ServerDraft("registry-server-json", false);
    draft.name = name;
    if (fullName && name !== fullName) draft.originalName = fullName;
    draft.transport = "http";
    draft.url = registryTemplate(remote.url as string, remote.variables, "url.", "registry-variable");
    const headers = Array.isArray(remote.headers) ? remote.headers.filter(isRecord) : [];
    for (const header of headers) {
      if (typeof header.name !== "string" || header.name === "") continue;
      const headerName = header.name;
      if (typeof header.value === "string" && header.value !== "") {
        draft.headers.push([headerName, registryTemplate(header.value, header.variables, `headers.${headerName}.`, "registry-header")]);
      } else {
        draft.headers.push([headerName, [registryPrompt(`headers.${headerName}`, headerName, "", header, "registry-header")]]);
      }
    }
    return { draft };
  });
}
