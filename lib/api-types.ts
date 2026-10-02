import type { McpExposure, ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import type { AgentCatalogAgent } from "./pi-subagents-catalog";
import type { McpImportNote } from "./mcp-import-core";
import type { SubagentProfile, SubagentRunInfo } from "./subagents";

export interface SubagentProfilesResponse {
  profiles: SubagentProfile[];
}

export interface SubagentCatalogResponse {
  agents: AgentCatalogAgent[];
}

/** One selectable child tool the profile editor can checkbox. */
export interface SubagentToolInfo {
  name: string;
  description?: string;
  source: "builtin" | "extension";
}

export interface SubagentToolsResponse {
  tools: SubagentToolInfo[];
}

/** Tool-result details persisted by the removed built-in subagent engine. */
export interface SubagentToolDetails {
  kind: "pi-web-subagent";
  sessionId: string;
  profile: string;
  description: string;
  status: SubagentRunInfo["status"];
  runInBackground: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeCleanupError?: string;
}

/** Code mode's one choice (ADR 0006): Automatic writes nothing, Always on adds `+codemode` to the global defaultTools. */
export type McpCodemodePreference = "automatic" | "always";

export interface ToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
  /** "always" when the global defaultTools starts sessions with codemode active (ADR 0006). */
  codemode: McpCodemodePreference;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

/** One file of a bulk `PATCH /api/skills`; `error` means it was left as it was. */
export interface SkillToggleResult {
  filePath: string;
  error?: string;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  /**
   * The nearest decision `trust.json` records for this folder or an ancestor,
   * null when there is none. Read for a folder that requires no trust too, so
   * a fresh folder (no decision anywhere) can be told from one inside a
   * trusted or untrusted tree.
   */
  decision: boolean | null;
  /** The folder that decision is recorded for, as `trust.json` keys it (its real path). */
  decisionPath?: string;
  /** The decision is recorded for an ancestor, so every folder below it shares it. */
  inherited: boolean;
  /**
   * Set only for a folder that requires no trust when `trust.json` could not
   * be read; `decision` is then null although one may exist. A folder that
   * requires trust reports the failure as an error instead.
   */
  decisionError?: string;
}

/**
 * Why Pi Web does not trust a fresh folder by itself when a project server is
 * added to it (`trustFreshFolderAndWrite()` in `lib/project-trust.ts`): a
 * decision is inherited by every folder below it, so trusting this one would
 * trust `path` too.
 * - `home`: the folder is the home folder;
 * - `root`: it is a filesystem root;
 * - `contains-home`: it holds the home folder (`path`);
 * - `contains-agent-dir`: it is, or holds, Pi's agent folder (`path`);
 * - `contains-folder`: it holds another folder Pi Web knows (`path`): a
 *   session's folder, its project, or a folder chosen in Pi Web;
 * - `contains-project`: it holds a project whose resources need trust and
 *   which has no decision (`path`), such as a repository cloned into it;
 * - `too-many-folders`: it holds more folders than Pi Web reads to look for
 *   such a project (`path` is the folder itself).
 */
export interface FreshFolderTrustBreadth {
  kind: "home" | "root" | "contains-home" | "contains-agent-dir" | "contains-folder" | "contains-project" | "too-many-folders";
  path: string;
}

/**
 * Whether adding a project server may trust the folder in the same step: only
 * a fresh folder, and not too broad a one. `folder-not-fresh`: the SDK sees
 * nothing that needs trust, but an entry where it looks is a link to nothing
 * (`hasTrustRelevantEntries()`), which would need trust once its target
 * appears, so the step refuses the folder.
 */
export type McpTrustFolderInfo =
  | { allowed: true }
  | { allowed: false; reason: "trust-too-broad"; breadth: FreshFolderTrustBreadth }
  | { allowed: false; reason: "folder-not-fresh" };

// ---------------------------------------------------------------------------
// Settings › MCP (ADR 0006). Every refusal carries `{ error, reason }`: `error`
// is an English diagnostic, `reason` a code the panel translates.
// ---------------------------------------------------------------------------

export type McpScope = "global" | "project";
export type McpTransportKind = "stdio" | "http";

/** A value the SDK resolves before it connects: a stdio `env` value, an HTTP header, or `oauth.clientSecret`. */
export interface McpConfigFieldRef {
  kind: "env" | "header" | "oauth-client-secret";
  /** The variable or header name; absent for `oauth.clientSecret`. */
  name?: string;
}

/**
 * A value that reads environment variables of the process connecting the
 * server (`${NAME}` or `$NAME`), named without expanding anything: a stdio
 * server gets them in its environment, an HTTP server in a header or in the
 * OAuth client secret it is sent.
 */
export interface McpVariableReference extends McpConfigFieldRef {
  variables: string[];
}

export type McpConfigFileProblemReason =
  /** The file is not JSON. */
  | "unparsable"
  /** Not an object with an `mcpServers` object. */
  | "invalid-shape"
  /** `autoEnableCodemode` is set to something other than a boolean; the servers still load. */
  | "auto-enable-codemode-invalid"
  /** A project file that is a symbolic link to nothing. */
  | "link-dangling"
  /** A project file whose real path is outside the folders Pi Web may read. */
  | "link-outside"
  /** Not a regular file (a directory, a FIFO, a device). */
  | "not-a-file"
  /** A project file larger than 1 MiB. */
  | "too-large"
  /** A project file that declares more servers than Pi Web lists (`MCP_PROJECT_MAX_SERVERS`, 200). */
  | "too-many-servers"
  | "unreadable";

export interface McpConfigFileProblem {
  reason: McpConfigFileProblemReason;
  error: string;
}

export interface McpConfigFileInfo {
  scope: McpScope;
  /** `<agent-dir>/mcp.json` or `<cwd>/.pi/mcp.json`, as the SDK names it. */
  path: string;
  /** Where the path leads when it, or a folder above it, is a symbolic link. */
  realPath?: string;
  exists: boolean;
  /** A problem other than `auto-enable-codemode-invalid` means no server of the file is listed. */
  problems: McpConfigFileProblem[];
  autoEnableCodemode?: boolean;
}

/**
 * One `mcpServers` entry, described from the file without resolving anything:
 * no `${VAR}` is expanded and no `!command` runs. Literal env and header
 * values are never included, and URL and argument parts that look like
 * secrets are masked.
 */
export interface McpServerInfo {
  name: string;
  scope: McpScope;
  sourcePath: string;
  /**
   * Identifies the entry's content, to tell a changed entry from the one a
   * status was recorded for: an HMAC of its canonical JSON under a per-process
   * key (`mcpConfigKey()`), never the JSON, which holds literal values.
   */
  configKey: string;
  enabled: boolean;
  /** False when the SDK's validator was unavailable; nothing below was checked. */
  validated: boolean;
  /** The SDK's reason for refusing the entry; it never connects. */
  invalidError?: string;
  /**
   * The entry is not a JSON object (`"name": "text"`), so it has no `enabled`
   * to switch: `enabled` reads true, pi refuses it, and it can only be removed.
   */
  notAnObject?: true;
  /**
   * What a connection uses: HTTP whenever the entry has a `url` key, as the
   * SDK's transport decides, even where the validator took it for stdio
   * (`type: "stdio"` beside a `url`). An entry with `invalidError` never
   * connects and gets the validator's reading (none for legacy SSE).
   */
  transport?: McpTransportKind;
  exposure?: McpExposure;
  command?: string;
  args?: string[];
  /** The configured working directory, relative to the session's. */
  cwd?: string;
  envNames: string[];
  url?: string;
  headerNames: string[];
  /** An HTTP server without an `Authorization` header signs in with OAuth when it answers 401. */
  usesOAuth: boolean;
  /** Whether `mcp-auth.json` holds an access token for the URL; absent when unknown or not an OAuth server. */
  signedIn?: boolean;
  /**
   * Whether `mcp-auth.json` holds anything for the URL: tokens, or what a
   * sign-in stores before any token (a dynamic client registration, the PKCE
   * verifier and state), which a cancelled or expired sign-in leaves behind.
   * Sign out removes all of it. Absent when unknown or not an OAuth server.
   */
  oauthStateStored?: boolean;
  /** Values that run a shell command on every connection. */
  commandFields: McpConfigFieldRef[];
  /** Values that read the host's environment variables on every connection; a `!command` is in `commandFields` instead. */
  variableReferences: McpVariableReference[];
  /** The value that references `PI_WEB_PASSWORD`; Pi Web refuses to connect such an entry. */
  webPasswordField?: McpConfigFieldRef;
  /** Some of `command`, `args` or `url` was masked. */
  masked: boolean;
  /** A global entry the project file defines too; the project's replaces it while the project is trusted. */
  shadowedByProject?: boolean;
  /** The project entry that replaces a global entry of its name while the project is trusted; the counterpart of `shadowedByProject`. */
  replacesGlobal?: boolean;
  /**
   * The last known connection state, from a test or an open session
   * (`lib/mcp-status.ts`): only while it was recorded for this entry as the
   * file holds it now (same `configKey`).
   */
  status?: McpServerStatus;
}

/** How a connection test ended (`POST /api/mcp/test`). */
export type McpTestState = "connected" | "needs-auth" | "failed";

/** One tool a tested server listed. */
export interface McpTestTool {
  name: string;
  /** The first line of its description (or title), shortened. */
  description?: string;
  /** The server marks it read-only (`annotations.readOnlyHint`). */
  readOnly: boolean;
  /** How it reaches the model under the entry's `exposure` and `toolExposure`. */
  exposure: McpExposure;
}

/**
 * What a connection test found. Literal env and header values, `!command`
 * texts, what they resolved to, and the secret parts of the command, the
 * arguments and the URL are masked in `error`, `stderr`, the tools'
 * descriptions and `serverInfo`.
 */
export interface McpTestResult {
  state: McpTestState;
  /** Why it failed, as the SDK words it, without the stderr tail (`stderr`); at most 2,000 characters. */
  error?: string;
  /** The last 2,000 characters a stdio server wrote to stderr, when it did not connect. */
  stderr?: string;
  /** The server did not answer within the test's deadline, and Pi Web stopped the test. */
  timedOut?: boolean;
  /** Another test of a server that runs a shell command held the queue past the deadline, so this one never started. */
  queueTimedOut?: boolean;
  /** At most `MCP_TEST_MAX_TOOLS`, in the server's order; `toolCount` counts all of them. */
  tools: McpTestTool[];
  toolCount: number;
  /** Present when the server offers resources. */
  resources?: number;
  resourceTemplates?: number;
  serverInfo?: { name: string; version: string; title?: string };
  /** The folder a stdio server ran in. */
  cwd?: string;
  /** From connecting to the result, without any wait in the queue. */
  durationMs: number;
  /** How long it waited for other tests of servers that run a shell command, when it did. */
  queuedMs?: number;
  /** When it finished, in milliseconds since the epoch. */
  testedAt: number;
  /** The connection a Settings sign-in made right after it stored new tokens (`lib/mcp-sign-in.ts`), not a Test. */
  afterSignIn?: true;
}

/**
 * What an open session's MCP host last saw of a server (`lib/mcp-host.ts`):
 * - `connecting`: the session opened a connection that has not finished;
 * - `connected`: its tools are registered in the session;
 * - `needs-auth`: the server asked for an OAuth sign-in;
 * - `failed`: the connection ended before the server was ready;
 * - `disconnected`: a connection that was ready dropped (a stdio server
 *   exited); the session connects again at the next call to one of its tools;
 * - `conflict`: another extension of the session registered an MCP server of
 *   that name first, so the session does not connect this entry;
 * - `not-trusted`: the project's `.pi/mcp.json` declares it, and the session
 *   did not read the file because no decision trusted the project.
 */
export type McpSessionState =
  | "connecting"
  | "connected"
  | "needs-auth"
  | "failed"
  | "disconnected"
  | "conflict"
  | "not-trusted";

/**
 * A server's state as a session's MCP host recorded it. Sessions report what
 * they see as it happens, and the latest report wins, whichever session made
 * it: a global stdio server runs once per session, each in its own folder,
 * so `cwd` says which one this is. Masked like a test's messages.
 */
export interface McpSessionStatus {
  origin: "session";
  state: McpSessionState;
  sessionId: string;
  /** The session's folder: a stdio server runs relative to it, and it is the MCP root the server is sent. */
  cwd: string;
  /** When the session saw it, in milliseconds since the epoch. */
  updatedAt: number;
  /** `failed`: why, as far as the transport says; at most 2,000 characters. */
  error?: string;
  /** `failed` / `disconnected`, stdio: the last 2,000 characters the server wrote to stderr. */
  stderr?: string;
  /** `conflict`: the extension whose server of that name the session kept. */
  conflict?: string;
  /**
   * `connected`: when the session closed that connection itself (it went
   * idle, ended, or reloaded), so the record says what it saw, not that it
   * still holds one. A closed report reads like an untested entry's row.
   */
  closedAt?: number;
}

/** A server's last known connection state: the newest of a test (`origin: "test"`) and an open session's report. */
export type McpServerStatus = ({ origin: "test" } & McpTestResult) | McpSessionStatus;

/**
 * An open session whose MCP host hands no server to the SDK, because the
 * session's `/mcp` command comes from another extension than Pi's built-in
 * MCP extension (which may then connect them its own way). Only a session can
 * tell: it takes loading the extensions.
 */
export interface McpHostInactiveInfo {
  /** The extension the `/mcp` command comes from. */
  owner: string;
  /** The session's folder. */
  cwd: string;
  updatedAt: number;
}

/** `POST /api/mcp/test`: which entry was tested, as the file held it, and what the test found. */
export interface McpTestResponse extends McpServerRef {
  /** The `configKey` of the entry the test read; the result belongs to that entry only. */
  configKey: string;
  result: McpTestResult;
}

export type McpUnavailableReason = "operator-disabled" | "internals-unavailable" | "builtin-disabled";

export type McpAvailability =
  | { available: true }
  | {
      available: false;
      reason: McpUnavailableReason;
      error: string;
      /** internals-unavailable: what failed to load. */
      detail?: string;
      /** builtin-disabled: the settings file whose `extensions` entry turns it off. */
      settingsPath?: string;
    };

export type CodemodeSandboxStatus =
  /** No normal session has started since the server did, so the self-test has not run. */
  | { state: "not-checked" }
  | { state: "available" }
  | { state: "unavailable"; error: string };

export interface McpCodemodeInfo {
  /** Absent when the global settings file cannot be read; see `preferenceError`. */
  preference?: McpCodemodePreference;
  preferenceError?: string;
  sandbox: CodemodeSandboxStatus;
  /** `-builtin:codemode` (or a pattern matching it) in the global or a trusted project's `extensions`. */
  builtinDisabled: boolean;
  builtinSettingsPath?: string;
  /**
   * The global settings file, when its `extensions` alone turn Code mode off,
   * whatever a project says. Always on writes the global `defaultTools`, which
   * every project's sessions read, so it is weighed against this rather than
   * `builtinDisabled`, which a trusted project's own list can change either way.
   */
  globalBuiltinSettingsPath?: string;
  /**
   * A trusted project whose `.pi/settings.json` `defaultTools` decides Code
   * mode for its sessions whatever the global choice (a plain list, or a
   * `+codemode` / `-codemode` modifier): `preference` is what its sessions get.
   * Only read with a cwd whose project settings sessions load.
   */
  projectOverride?: McpCodemodeProjectOverride;
}

export interface McpCodemodeProjectOverride {
  /** The project's `.pi/settings.json`. */
  settingsPath: string;
  /** "always" when its sessions start with `codemode` active, "automatic" when they start without it. */
  preference: McpCodemodePreference;
}

export interface McpProjectInfo {
  cwd: string;
  /** Absent when `trust.json` cannot be read; the project then counts as untrusted. */
  trust?: ProjectTrustStatus;
  trustError?: string;
  /**
   * Present only for a fresh folder (no resources that need trust, no
   * decision for it or an ancestor): adding a project server then trusts the
   * folder in the same request, unless that would trust too much.
   */
  trustFolder?: McpTrustFolderInfo;
}

export interface McpResponse {
  mcp: McpAvailability;
  codemode: McpCodemodeInfo;
  /** The global file, then the project file when a cwd was given. */
  files: McpConfigFileInfo[];
  /** Global entries, then project entries, each in file order. */
  servers: McpServerInfo[];
  project?: McpProjectInfo;
  /**
   * An open session that connects none of these servers through Pi Web: the
   * one in the panel's project when there is one, else the latest reported.
   */
  hostInactive?: McpHostInactiveInfo;
}

/**
 * Why a route refused a request: `/api/mcp`, `/api/mcp/test`,
 * `/api/mcp/sign-in`, `/api/mcp/sign-in/[flowId]`, `/api/project-trust` or
 * `/api/tools/settings`. Each code is described by its condition, not by the
 * route that added it first, since several routes share most of them; the
 * status a route answers with is noted where routes differ.
 */
export type McpRefusalReason =
  /** `cwd` is empty or not an absolute path. */
  | "cwd-invalid"
  /** `cwd` is outside the folders Pi Web may read, has a `..` segment, or does not exist. */
  | "cwd-denied"
  /** `cwd` is not a directory (anymore). */
  | "cwd-not-directory"
  /** A mutating request that did not come from Pi Web's own page (origin or host check). */
  | "request-denied"
  /** A mutating request whose body is not sent as JSON. */
  | "content-type"
  /** `trust.json` cannot be read, or is locked by another process: 500 from `GET /api/project-trust`, 409 from writes, add, Test and sign-in. */
  | "trust-unreadable"
  /** The project has no resources that need trust (anymore), so there is nothing to trust (`/api/project-trust`). */
  | "trust-not-required"
  /** A session in the folder is running, and trusting would rebuild it mid-run (`/api/project-trust`). */
  | "session-busy"
  /** The body is not a request the route can act on. */
  | "invalid-request"
  /** MCP is off on this server (`PI_WEB_DISABLE_MCP`, or the SDK's MCP modules cannot load), so Pi Web neither writes `mcp.json` nor connects a server. */
  | "mcp-off"
  /** A project entry, and no decision trusts the project, so its `.pi/mcp.json` is neither written nor connected. */
  | "project-untrusted"
  /** The file to write is not JSON; it was left as it is (`path`). */
  | "unparsable"
  /** The file to write is not an object with an `mcpServers` object; left as it is (`path`). */
  | "invalid-shape"
  /** The file does not define the server (anymore) (`path`, `name`). */
  | "server-missing"
  /** The entry is not a JSON object, so it cannot be switched on or off, only removed (`path`, `name`). */
  | "entry-not-object"
  /** The entry references `PI_WEB_PASSWORD`, so Pi Web does not turn it on, add, test or sign in to it (`name`). */
  | "web-password"
  /** The SDK's validator refuses the entry (`name`; `error` is the validator's message, which names fields, never values). */
  | "server-invalid"
  /** The undo token is unknown, used, or past its 60 seconds. */
  | "undo-unavailable"
  /** Undo would put back a name the file defines again since the removal (`name`). */
  | "undo-name-taken"
  /** The file already defines a server of that name (`name`; `path` when the writer found it under the lock; `suggestedName` on add). */
  | "name-taken"
  /** A project file that is a symbolic link to nothing (`path`). */
  | "link-dangling"
  /** A project file whose real path is outside the folders Pi Web may read (`path`). */
  | "link-outside"
  /** The path is not a regular file (`path`). */
  | "not-a-file"
  /** A project file larger than 1 MiB (`path`). */
  | "too-large"
  /** A project file that declares more than 200 servers, which Pi Web neither lists nor acts on (`path`). */
  | "too-many-servers"
  /** Another process held the file's lock for longer than the writer waits (`path`). */
  | "locked"
  /** Sign-in or sign-out of a server that does not use OAuth: only an HTTP server without an `Authorization` header does (`name`). */
  | "sign-in-not-oauth"
  /** No sign-in has that id: it ended over a minute ago, or Pi Web restarted (`/api/mcp/sign-in/[flowId]`). */
  | "sign-in-unknown"
  /** The sign-in is not waiting for a redirected address: not yet, or not anymore. */
  | "sign-in-not-waiting"
  /** The pasted text is not a URL. The sign-in keeps waiting. */
  | "redirect-invalid"
  /** The pasted URL's `state` is not this sign-in's: it belongs to another one. The sign-in keeps waiting. */
  | "redirect-state-mismatch"
  /** The pasted URL carries no authorization `code`. The sign-in keeps waiting. */
  | "redirect-no-code"
  /** The pasted URL is the authorization server's refusal (`error`); `error` holds its description. The sign-in keeps waiting. */
  | "redirect-denied"
  /** `add`: nothing in the pasted text could be read as a server (`notes`). */
  | "import-failed"
  /** `add`: a value the paste left to fill in is missing or invalid (`notes`). */
  | "fields-incomplete"
  /** `add`: the name is not one pi accepts (letters, digits, `_` and `-`) (`name`). */
  | "name-invalid"
  /** `add`: the server holds a literal secret (`fields`), so it is saved only in the global `mcp.json`. */
  | "secret-global-only"
  /** `add`: the server sends variables of the Pi Web host to a remote party (`names`); the request must confirm them. */
  | "host-env-confirm"
  /** `add` with `trustFolder`: the folder is no longer fresh (a decision, or resources that need one), so it was not trusted (`trust`). */
  | "folder-not-fresh"
  /** `add` with `trustFolder`: trusting the folder would trust more than it (`breadth`), so Pi Web does not do it by itself. */
  | "trust-too-broad"
  /** Reading failed unexpectedly; `error` says how. */
  | "internal";

export interface McpErrorResponse {
  error: string;
  reason: McpRefusalReason;
  /** The configured path of the file a write refusal is about. */
  path?: string;
  /** The server a refusal is about. */
  name?: string;
  /** `name-taken` on add: a name the file does not define yet. */
  suggestedName?: string;
  /** `import-failed`, `fields-incomplete`: why, as the importer's notes (`lib/mcp-import.ts`). */
  notes?: McpImportNote[];
  /** `host-env-confirm`: the host variables the server would be sent. */
  names?: string[];
  /** `secret-global-only`: where the literal secrets are (`env.API_KEY`, `headers.Authorization`, `url`). */
  fields?: string[];
  /** `trust-too-broad`: what trusting the folder would trust too. */
  breadth?: FreshFolderTrustBreadth;
  /** `folder-not-fresh`, and a write that failed after trusting: the folder's trust now, when it could be read. */
  trust?: ProjectTrustStatus;
  /**
   * `add` with `trustFolder`: the write failed after the folder was trusted,
   * and taking the trust back failed too, so the folder stays trusted with
   * nothing added. `reason` is the write's.
   */
  trustKept?: true;
}

/** What `POST /api/mcp` can do to a server of either file (ADR 0006: Add, a switch, Remove, Undo, and Sign out). */
export type McpServerAction = "enable" | "disable" | "remove" | "undo" | "set-enabled" | "sign-out" | "add";

export interface McpServerRef {
  scope: McpScope;
  name: string;
}

/**
 * The browser's handle on a removal it may undo: the token, never the entry,
 * which stays on the server and may hold literal secrets.
 */
export interface McpUndoInfo extends McpServerRef {
  token: string;
  /** The configured path it was removed from. */
  path: string;
  /** How long the undo stays possible from when the response was sent, in milliseconds. */
  expiresInMs: number;
}

/** One server of a bulk `set-enabled`: no `reason` means it now says what was asked. */
export interface McpActionItemResult extends McpServerRef {
  error?: string;
  reason?: McpRefusalReason;
}

/** `POST /api/mcp`: the overview read after the change, as GET returns it, plus what the action adds. */
export interface McpActionResponse extends McpResponse {
  /** `remove`: how to undo it. */
  undo?: McpUndoInfo;
  /** `undo`: the server put back. */
  restored?: McpServerRef;
  /** `set-enabled`: one result per server asked for, in request order. */
  results?: McpActionItemResult[];
  /** `sign-out`: the server signed out of, and whether `mcp-auth.json` held anything for its URL. */
  signedOut?: McpServerRef & { removed: boolean };
  /** `add`: the server written, and the configured path of its file. */
  added?: McpServerRef & { path: string };
  /** `add` to a project: the folder's trust after the write (it requires trust once `.pi/mcp.json` exists), for the page's trust status. */
  trust?: ProjectTrustStatus;
  /** `add` with `trustFolder`: the folder was trusted in the same request. */
  trustedFolder?: true;
}

/**
 * Where a Settings sign-in stands (`lib/mcp-sign-in.ts`), as `pi mcp login`
 * runs it:
 * - `connecting`: connecting once, to learn whether the server asks for a
 *   sign-in and with which challenge;
 * - `starting`: the SDK's sign-in runs (discovery, client registration) and
 *   has not produced a sign-in page yet;
 * - `authorize`: waiting for the browser, `authorizationUrl` to open; the
 *   loopback callback or a pasted redirected address finishes it;
 * - `finishing`: the code is being exchanged for tokens, then Pi Web
 *   connects again with them;
 * - `done`, `failed`, `cancelled`, `expired` (not finished within the SDK's
 *   5 minutes): ended.
 */
export type McpSignInPhase = "connecting" | "starting" | "authorize" | "finishing" | "done" | "failed" | "cancelled" | "expired";

/** Why a sign-in ended `failed`. */
export type McpSignInFailure =
  /** The first connection failed without asking for a sign-in, so there is nothing to sign in to; `result` says how. */
  | "connect-failed"
  /** Another test of a server that runs a shell command held the queue too long, so the sign-in never connected. */
  | "queue-timed-out"
  /** The SDK's sign-in failed (discovery, registration, the token exchange, a `!command` client secret); `error` says how. */
  | "sign-in-failed"
  | "internal";

/** `/api/mcp/sign-in`: one sign-in, as the browser polls it. URLs aside, server text in it is masked like a test's. */
export interface McpSignInFlowInfo extends McpServerRef {
  flowId: string;
  /** The `configKey` of the entry the sign-in read; another entry of the same URL joins it. */
  configKey: string;
  phase: McpSignInPhase;
  /** `authorize`: the sign-in page to open. */
  authorizationUrl?: string;
  /** `authorize`: where the browser is sent back, Pi Web's loopback listener on the computer running it. */
  redirectUrl?: string;
  /** How long the sign-in still waits, in milliseconds; 0 once it ended. */
  expiresInMs: number;
  /** `done`: the first connection worked, so no sign-in was needed. */
  alreadySignedIn?: true;
  /** `done`: the SDK renewed the tokens with the stored refresh token, without the browser. */
  refreshed?: true;
  /** `done`: what connecting with the new tokens found, also recorded as the server's status; `connect-failed`: what the first connection found. */
  result?: McpTestResult;
  failure?: McpSignInFailure;
  /** `failed`: the SDK's words, masked; at most 2,000 characters. */
  error?: string;
  /** In `POST /api/mcp/sign-in`'s answer only: the start joined this sign-in, already under way for the same URL. */
  joined?: true;
}

/** What a project's `.pi/mcp.json` declares, as `GET /api/project-trust` lists it. */
export interface ProjectMcpListing {
  /** The project file; absent only when listing failed (`mcpError`). */
  mcpFile?: McpConfigFileInfo;
  /** Its entries in file order, described like `McpResponse.servers`. */
  mcpServers: McpServerInfo[];
  /** Listing failed unexpectedly. */
  mcpError?: string;
}

/**
 * GET /api/project-trust: the trust status, plus what the project's
 * `.pi/mcp.json` declares, for the trust dialog to list before anyone trusts
 * the folder. Read from the file only, as `/api/mcp` reads it; nothing is
 * resolved or run.
 */
export interface ProjectTrustResponse extends ProjectTrustStatus, ProjectMcpListing {}

/**
 * GET /api/project-trust when `trust.json` cannot be read (500): the listing
 * still comes along, since it does not depend on the trust store, so the
 * dialog can show it while saying why the status is unknown.
 */
export interface ProjectTrustUnreadableResponse extends ProjectMcpListing {
  error: string;
  reason: "trust-unreadable";
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface PushConfigResponse {
  publicKey: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginStandaloneExtensionInfo extends PluginResourceInfo {
  kind: "extension";
  scope: PluginScope;
  enabled: boolean;
}

export type PluginUpdateState =
  | "update-available"
  | "up-to-date"
  | "unsupported"
  | "error";

export interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: PluginUpdateState;
  message?: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  canCheckForUpdates: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  description?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

/** One package of a bulk enable/disable; `error` means it was left as it was. */
export interface PluginToggleResult {
  source: string;
  scope: PluginScope;
  error?: string;
}

export interface PluginsBulkResponse extends PluginsResponse {
  results: PluginToggleResult[];
}
