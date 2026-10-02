import type {
  CodemodeInlineBudgetSetting,
  CodemodeMode,
  CodemodeModeSetting,
  FreshFolderTrustBreadth,
  McpActionResponse,
  McpAvailability,
  McpCodemodeInfo,
  McpCodemodeInlineBudget,
  McpCodemodeMode,
  McpCodemodePreference,
  McpConfigFileInfo,
  McpConfigFileProblem,
  McpErrorResponse,
  McpProjectInfo,
  McpRefusalReason,
  McpResponse,
  McpScope,
  McpServerInfo,
  McpServerRef,
  McpServerStatus,
  McpSessionState,
  McpSessionStatus,
  McpTestResponse,
  McpTestResult,
  ProjectTrustStatus,
} from "@/lib/api-types";
import type { McpImportFieldValue, McpImportNote } from "@/lib/mcp-import";
import { itemsToSwitch } from "./settings-ui-helpers";

// Pure helpers for Settings › MCP (components/McpConfig.tsx): what each row
// shows, how the groups are built, and how the overview is loaded. Client-safe:
// types and fetch only. Every state here is derived from the files GET /api/mcp
// read, refined by a server's last known status (`status`, from a Test or an
// open session) where the file lets it connect.

/** The sidebar selection of the Code mode row; a server's key always holds a NUL. */
export const MCP_CODEMODE_SELECTION = "codemode";

/** A server's sidebar selection: its scope and name, which are unique within one listing. */
export function mcpServerKey(server: Pick<McpServerInfo, "scope" | "name">): string {
  return `${server.scope}\0${server.name}`;
}

/**
 * What a row says about an entry, most important first. From the file: an
 * entry pi refuses, one Pi Web refuses because it references PI_WEB_PASSWORD,
 * one turned off in the file, a project entry of a project whose servers may
 * not be read, a global entry the trusted project's entry of the same name
 * replaces, and MCP being off on this server. Only an entry the file lets
 * connect then shows its last known status (`mcpStatusRowState()`), from the
 * last Test of the entry as the file holds it now or from what an open
 * session reported since: `connected`, `needs-auth`, `failed`, and from a
 * session also `connecting`, `disconnected` (a connection that was ready
 * dropped) and `conflict` (another extension holds the name). `on` means only
 * that a session would connect it; nothing says whether one did.
 */
export type McpServerRowState =
  | "invalid"
  | "web-password"
  | "disabled"
  | "not-trusted"
  | "replaced"
  | "mcp-off"
  | "connected"
  | "needs-auth"
  | "failed"
  | "connecting"
  | "disconnected"
  | "conflict"
  | "on";

export const MCP_SERVER_ROW_STATES: readonly McpServerRowState[] = [
  "invalid",
  "web-password",
  "disabled",
  "not-trusted",
  "replaced",
  "mcp-off",
  "connected",
  "needs-auth",
  "failed",
  "connecting",
  "disconnected",
  "conflict",
  "on",
];

export interface McpRowContext {
  /** MCP is available on this Pi Web server (not turned off by the operator or a setting). */
  mcpAvailable: boolean;
  /** A session may read the project's `.pi/mcp.json` (see `mcpProjectServersLoad()`). */
  projectServersLoad: boolean;
}

/**
 * Whether sessions read the project's `.pi/mcp.json`: only while a decision,
 * exact or inherited, trusts the folder, as the MCP host's
 * `mayReadProjectConfigNow()` decides on every prompt. Not `trust.trusted`,
 * which is true for a folder that requires no trust; that folder has no
 * `.pi/mcp.json`, and one that appeared after the status was read is not read
 * without a decision. An unreadable trust store counts as untrusted.
 */
export function mcpProjectServersLoad(project: McpProjectInfo | undefined): boolean {
  return project?.trust?.decision === true;
}

export function mcpRowContext(data: Pick<McpResponse, "mcp" | "project">): McpRowContext {
  return { mcpAvailable: data.mcp.available, projectServersLoad: mcpProjectServersLoad(data.project) };
}

/**
 * The row state a last known status gives an entry the file lets connect. Two
 * session reports say nothing about now, so the entry reads `on` and its
 * Connection row says what that session saw: a connection the session closed
 * since (it went idle or ended), and a project the session found untrusted,
 * an older trust than the listing, which says sessions read the project now.
 */
export function mcpStatusRowState(status: McpServerStatus): McpServerRowState {
  if (status.origin === "test") return status.state;
  return status.closedAt !== undefined || status.state === "not-trusted" ? "on" : status.state;
}

export function mcpServerRowState(server: McpServerInfo, context: McpRowContext): McpServerRowState {
  if (server.invalidError !== undefined) return "invalid";
  if (server.webPasswordField) return "web-password";
  if (!server.enabled) return "disabled";
  if (server.scope === "project" && !context.projectServersLoad) return "not-trusted";
  // The project's entry replaces this one only where it is read.
  if (server.scope === "global" && server.shadowedByProject && context.projectServersLoad) return "replaced";
  if (!context.mcpAvailable) return "mcp-off";
  return server.status ? mcpStatusRowState(server.status) : "on";
}

/** The full state text, for the row's accessible name and the detail pane. */
export const MCP_ROW_STATE_LABEL_KEYS: Record<McpServerRowState, string> = {
  invalid: "mcp.state.invalid",
  "web-password": "mcp.state.web-password",
  disabled: "mcp.state.disabled",
  "not-trusted": "mcp.state.not-trusted",
  replaced: "mcp.state.replaced",
  "mcp-off": "mcp.state.mcp-off",
  connected: "mcp.state.connected",
  "needs-auth": "mcp.state.needs-auth",
  failed: "mcp.state.failed",
  connecting: "mcp.state.connecting",
  disconnected: "mcp.state.disconnected",
  conflict: "mcp.state.conflict",
  on: "mcp.state.on",
};

/** The labels that say where a state was seen, for a state an open session reported rather than a test. */
export const MCP_SESSION_ROW_STATE_LABEL_KEYS: Partial<Record<McpServerRowState, string>> = {
  connected: "mcp.state.session.connected",
  failed: "mcp.state.session.failed",
};

/** A row's full state text: in a session's words when an open session reported it. */
export function mcpRowStateLabelKey(state: McpServerRowState, status: McpServerStatus | undefined): string {
  return (status?.origin === "session" ? MCP_SESSION_ROW_STATE_LABEL_KEYS[state] : undefined) ?? MCP_ROW_STATE_LABEL_KEYS[state];
}

/**
 * The sentence under a server's state in its pane: why it does or does not
 * connect. None for `invalid` and `web-password`, which the pane words with
 * the reason itself, none for `connected`, `needs-auth`, `failed` and
 * `connecting`, which the Connection row right under it reports with where and
 * when they were seen, and none for `on`, which needs no explaining.
 */
export const MCP_ROW_STATE_DETAIL_KEYS: Partial<Record<McpServerRowState, string>> = {
  disabled: "mcp.server.disabled",
  "not-trusted": "mcp.stateDetail.not-trusted",
  replaced: "mcp.server.shadowedByProject",
  "mcp-off": "mcp.stateDetail.mcp-off",
  disconnected: "mcp.stateDetail.disconnected",
  conflict: "mcp.stateDetail.conflict",
};

export function mcpRowStateDetailKey(state: McpServerRowState): string | undefined {
  return MCP_ROW_STATE_DETAIL_KEYS[state];
}

/**
 * The short text a row shows beside the name, so a state is never told by the
 * dot's color alone. None for `on` and `connected`, which need nothing done,
 * and none for `mcp-off`, which the banner above the list says once for every
 * row.
 */
export const MCP_ROW_STATE_BADGE_KEYS: Partial<Record<McpServerRowState, string>> = {
  invalid: "mcp.stateShort.invalid",
  "web-password": "mcp.stateShort.web-password",
  disabled: "mcp.stateShort.disabled",
  "not-trusted": "mcp.stateShort.not-trusted",
  replaced: "mcp.stateShort.replaced",
  "needs-auth": "mcp.stateShort.needs-auth",
  failed: "mcp.stateShort.failed",
  connecting: "mcp.stateShort.connecting",
  disconnected: "mcp.stateShort.disconnected",
  conflict: "mcp.stateShort.conflict",
};

export type McpStateTone = "on" | "off" | "warning" | "error";

/** How a state is colored: the dot, and the state text in the detail pane. */
export function mcpRowStateTone(state: McpServerRowState): McpStateTone {
  if (state === "on" || state === "connected") return "on";
  if (state === "invalid" || state === "web-password" || state === "failed" || state === "conflict") return "error";
  if (state === "not-trusted" || state === "needs-auth" || state === "disconnected") return "warning";
  return "off";
}

/** `ConfigStatusDot` props for a tone: the accent for on, dim for off, else a warning or error color. */
export function mcpStatusDot(tone: McpStateTone): { active?: boolean; color?: string } {
  if (tone === "on") return { active: true };
  if (tone === "off") return { active: false };
  return { color: tone === "error" ? "#ef4444" : "#f59e0b" };
}

/** When a status was written: a test's end, or a session's report, or its closing of that connection. */
export function mcpStatusTime(status: McpServerStatus): number {
  return status.origin === "test" ? status.testedAt : status.closedAt ?? status.updatedAt;
}

/**
 * A status's time in the Connection row: the time of day, with the date when
 * it was not today. Records last as long as the server process, and a session
 * that connected a server yesterday must not read like one that did a minute ago.
 */
export function mcpStatusTimeText(time: number, locale: string, now: number = Date.now()): string {
  const date = new Date(time);
  const today = new Date(now);
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** The state word of a session's report in the Connection row. */
export const MCP_SESSION_STATE_KEYS: Record<McpSessionState, string> = {
  connecting: "mcp.session.state.connecting",
  connected: "mcp.session.state.connected",
  "needs-auth": "mcp.session.state.needs-auth",
  failed: "mcp.session.state.failed",
  disconnected: "mcp.session.state.disconnected",
  conflict: "mcp.session.state.conflict",
  "not-trusted": "mcp.session.state.not-trusted",
};

/** The sentence after it: which session (by its folder) saw what, and when. */
export const MCP_SESSION_SUMMARY_KEYS: Record<McpSessionState, string> = {
  connecting: "mcp.session.summary.connecting",
  connected: "mcp.session.summary.connected",
  "needs-auth": "mcp.session.summary.needs-auth",
  failed: "mcp.session.summary.failed",
  disconnected: "mcp.session.summary.disconnected",
  conflict: "mcp.session.summary.conflict",
  "not-trusted": "mcp.session.summary.not-trusted",
};

const SESSION_STATE_TONES: Record<McpSessionState, McpStateTone> = {
  connecting: "off",
  connected: "on",
  "needs-auth": "warning",
  failed: "error",
  disconnected: "warning",
  conflict: "error",
  "not-trusted": "warning",
};

/** The state line of a session's report: its word and tone; a connection the session closed since is neutral. */
export function mcpSessionStateView(status: Pick<McpSessionStatus, "state" | "closedAt">): { key: string; tone: McpStateTone } {
  if (status.closedAt !== undefined) return { key: "mcp.session.state.closed", tone: "off" };
  return { key: MCP_SESSION_STATE_KEYS[status.state], tone: SESSION_STATE_TONES[status.state] };
}

/** The sentence after the state word: `{path}` and `{time}`, and `{closedTime}` for a connection closed since. */
export function mcpSessionSummaryKey(status: Pick<McpSessionStatus, "state" | "closedAt">): string {
  return status.closedAt !== undefined ? "mcp.session.summary.closed" : MCP_SESSION_SUMMARY_KEYS[status.state];
}

/** How a validated entry's tools reach the model (the SDK's `exposure`, `codemode` by default). */
export const MCP_EXPOSURE_KEYS: Record<NonNullable<McpServerInfo["exposure"]>, string> = {
  codemode: "mcp.exposure.codemode",
  deferred: "mcp.exposure.deferred",
  direct: "mcp.exposure.direct",
  hidden: "mcp.exposure.hidden",
};

/**
 * The exposures a server's Tools row offers, in the order the SDK lists them:
 * the default first, then cheaper to dearer for the model's context, then
 * none at all. An entry still holding the old `codemode-deferred` reads as
 * `codemode` (GET reports the validator's copy), which is what it now means.
 */
export const MCP_EXPOSURE_OPTIONS: readonly NonNullable<McpServerInfo["exposure"]>[] = [
  "codemode",
  "deferred",
  "direct",
  "hidden",
];

/** The same, as a tag beside one tested tool whose `toolExposure` differs from its server's. */
export const MCP_EXPOSURE_SHORT_KEYS: Record<NonNullable<McpServerInfo["exposure"]>, string> = {
  codemode: "mcp.exposureShort.codemode",
  deferred: "mcp.exposureShort.deferred",
  direct: "mcp.exposureShort.direct",
  hidden: "mcp.exposureShort.hidden",
};

/** A file problem other than this one means none of the file's servers is listed. */
export function isBlockingFileProblem(problem: McpConfigFileProblem): boolean {
  return problem.reason !== "auto-enable-codemode-invalid";
}

export interface McpServerGroup {
  scope: McpScope;
  /** Absent when the file was not read: a project the route refused (see the load's `projectError`). */
  file?: McpConfigFileInfo;
  servers: McpServerInfo[];
}

/**
 * The sidebar groups: Project first, as in the other panels, but only with a
 * project; Global always. The project group stays when its file is missing or
 * was not read, so the panel says so instead of hiding where project servers go.
 */
export function mcpServerGroups(data: Pick<McpResponse, "files" | "servers">, hasProject: boolean): McpServerGroup[] {
  const scopes: McpScope[] = hasProject ? ["project", "global"] : ["global"];
  return scopes.map((scope) => {
    const file = data.files.find((info) => info.scope === scope);
    return {
      scope,
      ...(file ? { file } : {}),
      servers: data.servers.filter((server) => server.scope === scope),
    };
  });
}

/** Turned-on and total entries, the `n/m` a group heading shows. */
export function mcpGroupCounts(servers: readonly Pick<McpServerInfo, "enabled">[]): { enabled: number; total: number } {
  return { enabled: servers.filter((server) => server.enabled).length, total: servers.length };
}

/** Why a group lists nothing, when it lists nothing. */
export function mcpGroupEmptyKey(group: McpServerGroup): string | undefined {
  if (group.servers.length > 0) return undefined;
  if (!group.file) return "mcp.group.notListed";
  if (group.file.problems.some(isBlockingFileProblem)) return "mcp.group.fileProblem";
  return "mcp.group.empty";
}

/**
 * What the detail pane says with no row selected: to pick one, or, with
 * nothing listed, that a file problem hides the servers or that there are none.
 */
export function mcpEmptyDetailKey(serverCount: number, files: readonly McpConfigFileInfo[]): string {
  if (serverCount > 0) return "mcp.selectItem";
  return files.some((file) => file.problems.some(isBlockingFileProblem)) ? "mcp.emptyFileProblem" : "mcp.empty";
}

/**
 * The row to select after a load: the remembered one while it still exists,
 * else the first server (the project's first), else none, which shows the
 * empty state. Code mode is always there.
 */
export function pickMcpSelection(groups: readonly McpServerGroup[], current: string | null): string | null {
  const keys = groups.flatMap((group) => group.servers.map(mcpServerKey));
  if (current === MCP_CODEMODE_SELECTION || (current !== null && keys.includes(current))) return current;
  return keys[0] ?? null;
}

export interface McpNoticeText {
  key: string;
  params?: Record<string, string>;
}

/** Why no session connects any server: MCP is off, with the reason the route gave. */
export function mcpUnavailableNotice(mcp: McpAvailability): McpNoticeText | undefined {
  if (mcp.available) return undefined;
  if (mcp.reason === "builtin-disabled") {
    return mcp.settingsPath
      ? { key: "mcp.unavailable.builtin-disabled", params: { path: mcp.settingsPath } }
      : { key: "mcp.unavailable.builtin-disabled-unknown" };
  }
  return { key: mcp.reason === "operator-disabled" ? "mcp.unavailable.operator-disabled" : "mcp.unavailable.internals-unavailable" };
}

export type McpTrustNotice =
  /** The project servers do not connect; the trust notice, with Trust where `mcpProjectTrustable()` says so. */
  | (McpNoticeText & { kind: "untrusted" })
  /** They connect because an ancestor is trusted, which every folder under it shares. */
  | (McpNoticeText & { kind: "inherited" });

/**
 * What the panel says about the project's trust, only when the project has a
 * `.pi/mcp.json` (or a problem with one), since that is all trust changes here:
 * that its servers do not connect, naming the folder an inherited `false` was
 * recorded for, or that they connect through an ancestor's trust. The trust
 * dialog never opens for a folder trusted through a parent, so this is where
 * that trust is visible.
 *
 * Nothing is said for a folder that requires no trust, unless a decision
 * marks it untrusted: the reader lists a `.pi/mcp.json` that is a dangling
 * link, while the SDK's `existsSync` follows it, finds nothing, and so has
 * nothing to trust (`POST /api/project-trust` answers `trust-not-required`).
 * The footer's file problem explains that file instead.
 */
export function mcpTrustNotice(project: McpProjectInfo | undefined, projectFile: McpConfigFileInfo | undefined): McpTrustNotice | undefined {
  if (!project || !projectFile || (!projectFile.exists && projectFile.problems.length === 0)) return undefined;
  const { trust } = project;
  if (!trust) return { kind: "untrusted", key: "mcp.trust.unreadable" };
  if (!trust.requiresTrust && trust.decision !== false) return undefined;
  if (trust.decision === true) {
    return trust.inherited && trust.decisionPath
      ? { kind: "inherited", key: "mcp.trust.trustedThrough", params: { path: trust.decisionPath } }
      : undefined;
  }
  if (trust.decision === false && trust.inherited && trust.decisionPath) {
    return { kind: "untrusted", key: "mcp.trust.untrustedThrough", params: { path: trust.decisionPath } };
  }
  return { kind: "untrusted", key: "mcp.trust.untrusted" };
}

/**
 * Whether the untrusted notice offers Trust: only while the folder requires
 * trust and is not trusted, as the trust dialog and `POST /api/project-trust`
 * see it. Not for an unreadable `trust.json` (trusting would fail the same
 * way, and whether the folder needs trust is unknown), nor for an explicit
 * `false` on a folder that no longer requires trust (a dangling `.pi/mcp.json`
 * link), where POST answers `trust-not-required`.
 */
export function mcpProjectTrustable(project: McpProjectInfo | undefined): boolean {
  const trust = project?.trust;
  return trust !== undefined && trust.requiresTrust && !trust.trusted;
}

/** Every file problem, the global file's first, for the footer. */
export function mcpFileProblems(files: readonly McpConfigFileInfo[]): { file: McpConfigFileInfo; problem: McpConfigFileProblem }[] {
  return [...files]
    .sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "global" ? -1 : 1))
    .flatMap((file) => file.problems.map((problem) => ({ file, problem })));
}

/** The `autoEnableCodemode` a session started now reads, and the file that sets it. */
export type McpAutoEnableCodemode = { value: true; path?: string } | { value: false; path: string };

/**
 * `autoEnableCodemode` as the SDK's `loadMcpConfig()` merges it: the project
 * file's value where a session reads that file, else the global file's, else
 * true. The MCP extension reads it on `session_start`, so it applies to
 * sessions started (or reloaded) afterwards.
 */
export function mcpEffectiveAutoEnableCodemode(data: Pick<McpResponse, "files" | "project">): McpAutoEnableCodemode {
  const project = data.files.find((file) => file.scope === "project");
  if (project?.autoEnableCodemode !== undefined && mcpProjectServersLoad(data.project)) {
    return project.autoEnableCodemode ? { value: true, path: project.path } : { value: false, path: project.path };
  }
  const global = data.files.find((file) => file.scope === "global");
  if (global?.autoEnableCodemode !== undefined) {
    return global.autoEnableCodemode ? { value: true, path: global.path } : { value: false, path: global.path };
  }
  return { value: true };
}

/**
 * The Code mode a session started now gets in the panel's context: what the
 * project's settings decide, where they decide it (`projectOverride`), else
 * the global choice; undefined when the global settings cannot be read.
 */
export function mcpEffectiveCodemodePreference(codemode: McpCodemodeInfo): McpCodemodePreference | undefined {
  return codemode.projectOverride?.preference ?? codemode.preference;
}

/**
 * Why the tools of a server with `codemode` exposure, which only Code mode
 * scripts call, may not be callable, most decisive first:
 * the sandbox cannot run (the MCP host then offers them through tool search),
 * `-builtin:codemode` registers no codemode tool (the host keeps their
 * exposure, so only an active tool search reaches them), or Automatic with
 * `autoEnableCodemode: false`, under which the MCP extension never turns Code
 * mode on. Automatic is the effective choice, so a project whose settings
 * start its sessions with Code mode on needs no warning, and one that starts
 * them without it does. Undefined when a session turns Code mode on for them.
 */
export function mcpCodemodeReachNotice(codemode: McpCodemodeInfo, autoEnable: McpAutoEnableCodemode): McpNoticeText | undefined {
  if (codemode.sandbox.state === "unavailable") return { key: "mcp.exposure.sandboxUnavailable" };
  if (codemode.builtinDisabled) return { key: "mcp.exposure.builtinDisabled" };
  if (!autoEnable.value && mcpEffectiveCodemodePreference(codemode) !== "always") {
    return { key: "mcp.exposure.autoEnableOff", params: { path: autoEnable.path } };
  }
  return undefined;
}

/**
 * Why the tools of a server with `exposure` may not be callable, for the
 * exposure the row shows: the Code mode cases of `mcpCodemodeReachNotice()`
 * for `codemode`, and for `deferred`, tool search
 * turned off by `-builtin:tool-search`, which leaves those tools to Code mode
 * scripts alone. Undefined when a session reaches them.
 */
export function mcpExposureReachNotice(
  exposure: NonNullable<McpServerInfo["exposure"]>,
  data: Pick<McpResponse, "codemode" | "toolSearchDisabled">,
  autoEnable: McpAutoEnableCodemode,
): McpNoticeText | undefined {
  if (exposure === "codemode") return mcpCodemodeReachNotice(data.codemode, autoEnable);
  if (exposure !== "deferred" || !data.toolSearchDisabled) return undefined;
  const path = data.toolSearchDisabled.settingsPath;
  return path ? { key: "mcp.exposure.toolSearchDisabled", params: { path } } : { key: "mcp.exposure.toolSearchDisabledUnknown" };
}

/**
 * The warning under the choice when Automatic is in effect and the file
 * setting keeps it from ever turning Code mode on: the global Automatic, or a
 * project's settings that start its sessions without Code mode.
 */
export function mcpCodemodeAutomaticNotice(codemode: McpCodemodeInfo, autoEnable: McpAutoEnableCodemode): McpNoticeText | undefined {
  if (mcpEffectiveCodemodePreference(codemode) !== "automatic" || autoEnable.value) return undefined;
  return { key: "mcp.codemode.autoEnableOff", params: { path: autoEnable.path } };
}

/**
 * Why Always on cannot be chosen, shown under the switch: no session can
 * offer Code mode, because its sandbox failed the self-test (checked first,
 * as nothing in Settings fixes it) or the global `extensions` turn it off
 * (`-builtin:codemode`). Always on writes the global `defaultTools`, which
 * every project's sessions read, so only the global settings count: a trusted
 * project that turns Code mode off for its own sessions leaves Always on
 * working everywhere else (`mcpCodemodeBuiltinNotice()` says so), and one that
 * turns it back on does not make the global choice work elsewhere. Whether
 * the switch is offered never depends on which project Settings was opened
 * from. A sandbox nobody has checked yet leaves it available; the Sandbox
 * line says so.
 */
export function mcpCodemodeAlwaysUnavailableNotice(codemode: McpCodemodeInfo): McpNoticeText | undefined {
  if (codemode.sandbox.state === "unavailable") return { key: "mcp.codemode.alwaysUnavailable.sandbox" };
  if (!codemode.globalBuiltinSettingsPath) return undefined;
  return { key: "mcp.codemode.alwaysUnavailable.builtin", params: { path: codemode.globalBuiltinSettingsPath } };
}

/**
 * The Built-in line of the Code mode pane: `-builtin:codemode` turns Code mode
 * off for the sessions the panel describes, naming the file that does. When
 * only the trusted project's own list does it, the line adds that Always on
 * still applies to sessions in other folders, since the switch stays offered.
 */
export function mcpCodemodeBuiltinNotice(codemode: McpCodemodeInfo): McpNoticeText | undefined {
  if (!codemode.builtinDisabled) return undefined;
  const path = codemode.builtinSettingsPath;
  if (!path) return { key: "mcp.codemode.builtinDisabledUnknown" };
  return codemode.globalBuiltinSettingsPath
    ? { key: "mcp.codemode.builtinDisabled", params: { path } }
    : { key: "mcp.codemode.builtinDisabledProject", params: { path } };
}

export const MCP_CODEMODE_PROJECT_OVERRIDE_KEYS: Record<McpCodemodePreference, string> = {
  always: "mcp.codemode.projectOverride.always",
  automatic: "mcp.codemode.projectOverride.automatic",
};

/**
 * That the panel's project decides Code mode for its own sessions through the
 * `defaultTools` of its `.pi/settings.json`, so the global choice does not
 * reach them, naming the file, the way a project-scope refusal of the model
 * default does. Said whether or not it agrees with the global choice: either
 * way, changing the choice changes nothing there.
 */
export function mcpCodemodeProjectOverrideNotice(codemode: McpCodemodeInfo): McpNoticeText | undefined {
  const override = codemode.projectOverride;
  if (!override) return undefined;
  return { key: MCP_CODEMODE_PROJECT_OVERRIDE_KEYS[override.preference], params: { path: override.settingsPath } };
}

/** The overview after a save: the stored preference, and no read error, since the file was just read. */
export function withMcpCodemodePreference(data: McpResponse, preference: McpCodemodePreference): McpResponse {
  const codemode: McpCodemodeInfo = { ...data.codemode, preference };
  delete codemode.preferenceError;
  return { ...data, codemode };
}

export const MCP_CODEMODE_MODE_KEYS: Record<CodemodeMode, string> = {
  on: "mcp.codemode.toolMode.on",
  only: "mcp.codemode.toolMode.only",
};

export const MCP_CODEMODE_MODE_DESCRIPTION_KEYS: Record<CodemodeMode, string> = {
  on: "mcp.codemode.toolMode.onDescription",
  only: "mcp.codemode.toolMode.onlyDescription",
};

const MCP_CODEMODE_MODE_PROJECT_OVERRIDE_KEYS: Record<CodemodeMode, string> = {
  on: "mcp.codemode.toolMode.projectOverride.on",
  only: "mcp.codemode.toolMode.projectOverride.only",
};

/**
 * Whether choosing `value` changes the global settings: another mode, or
 * either one over a stored value pi reads as "on" without it being a mode,
 * which saving replaces.
 */
export function mcpCodemodeModeChanges(mode: McpCodemodeMode, value: CodemodeMode): boolean {
  return value !== mode.value || mode.invalid !== undefined;
}

/**
 * The lines under the mode switch: a global value pi reads as "on" without it
 * being a mode; a trusted project whose settings give its sessions their own
 * mode (said whether or not it agrees, as for the Code mode choice); and,
 * when sessions get "only" while Automatic decides when Code mode turns on,
 * that until then the model calls these tools directly. With
 * `autoEnableCodemode: false` Automatic never turns it on, which the choice's
 * own warning says.
 */
export function mcpCodemodeModeNotices(codemode: McpCodemodeInfo): McpNoticeText[] {
  const mode = codemode.mode;
  if (!mode) return [];
  const notices: McpNoticeText[] = [];
  if (mode.invalid !== undefined) {
    notices.push({ key: "mcp.codemode.toolMode.invalid", params: { path: mode.settingsPath, value: mode.invalid } });
  }
  const project = mode.projectOverride;
  if (project) {
    notices.push({ key: MCP_CODEMODE_MODE_PROJECT_OVERRIDE_KEYS[project.value], params: { path: project.settingsPath } });
  }
  if ((project ?? mode).value === "only" && mcpEffectiveCodemodePreference(codemode) === "automatic") {
    notices.push({ key: "mcp.codemode.toolMode.automaticNote" });
  }
  return notices;
}

/** The overview after a mode save: the stored value, keeping the file and the project's own. */
export function withMcpCodemodeMode(data: McpResponse, stored: CodemodeModeSetting): McpResponse {
  const current = data.codemode.mode;
  if (!current) return data;
  const mode: McpCodemodeMode = {
    settingsPath: current.settingsPath,
    ...(current.projectOverride ? { projectOverride: current.projectOverride } : {}),
    ...stored,
  };
  return { ...data, codemode: { ...data.codemode, mode } };
}

/** The overview after a budget save: the stored value, keeping the default, the limit and the project's own. */
export function withMcpCodemodeInlineBudget(data: McpResponse, stored: CodemodeInlineBudgetSetting): McpResponse {
  const current = data.codemode.inlineBudget;
  if (!current) return data;
  const inlineBudget: McpCodemodeInlineBudget = {
    settingsPath: current.settingsPath,
    default: current.default,
    max: current.max,
    ...(current.projectOverride ? { projectOverride: current.projectOverride } : {}),
    ...stored,
  };
  return { ...data, codemode: { ...data.codemode, inlineBudget } };
}

/** The budget field's text for a stored value: empty for pi's default, which the placeholder shows. */
export function mcpInlineBudgetDraftOf(budget: Pick<McpCodemodeInlineBudget, "value">): string {
  return budget.value === undefined ? "" : String(budget.value);
}

/** What the budget field asks to save: a whole number up to `max`, or null (empty) for pi's default. */
export type McpInlineBudgetDraft = { ok: true; value: number | null } | { ok: false };

export function parseMcpInlineBudgetDraft(text: string, max: number): McpInlineBudgetDraft {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return value <= max ? { ok: true, value } : { ok: false };
}

/**
 * Whether saving the draft changes the global settings: a different budget,
 * or an empty field over a value pi ignores, which saving removes.
 */
export function mcpInlineBudgetDraftChanges(budget: McpCodemodeInlineBudget, draft: McpInlineBudgetDraft): boolean {
  if (!draft.ok) return false;
  if (draft.value === null) return budget.value !== undefined || budget.invalid !== undefined;
  return draft.value !== budget.value;
}

/**
 * The warnings under the budget field: a global value pi ignores, and a
 * trusted project whose settings give its sessions their own budget (said
 * whether or not it agrees, as for the Code mode choice).
 */
export function mcpCodemodeInlineBudgetNotices(budget: McpCodemodeInlineBudget): McpNoticeText[] {
  const notices: McpNoticeText[] = [];
  if (budget.invalid !== undefined) {
    notices.push({
      key: "mcp.codemode.inlineBudget.invalid",
      params: { path: budget.settingsPath, value: budget.invalid, default: String(budget.default) },
    });
  }
  const project = budget.projectOverride;
  if (project) {
    notices.push(project.value !== undefined
      ? { key: "mcp.codemode.inlineBudget.projectOverride", params: { path: project.settingsPath, value: String(project.value) } }
      : { key: "mcp.codemode.inlineBudget.projectOverrideDefault", params: { path: project.settingsPath, default: String(budget.default) } });
  }
  return notices;
}

export type McpCodemodeRowState = "automatic" | "always" | "unavailable" | "unknown";

/**
 * The Code mode row's state: unavailable when no session can offer it (its
 * sandbox failed the self-test, or `-builtin:codemode` turns it off), unknown
 * when the global settings file cannot be read, else the preference.
 */
export function mcpCodemodeRowState(codemode: McpCodemodeInfo): McpCodemodeRowState {
  if (codemode.builtinDisabled || codemode.sandbox.state === "unavailable") return "unavailable";
  return codemode.preference ?? "unknown";
}

export const MCP_CODEMODE_STATE_KEYS: Record<McpCodemodeRowState, string> = {
  automatic: "mcp.codemode.automatic",
  always: "mcp.codemode.always",
  unavailable: "mcp.codemode.unavailable",
  unknown: "i18n.unknown",
};

export function mcpCodemodeTone(state: McpCodemodeRowState): McpStateTone {
  if (state === "unavailable") return "error";
  return state === "unknown" ? "off" : "on";
}

// ---------------------------------------------------------------------------
// Loading GET /api/mcp
// ---------------------------------------------------------------------------

/** Why loading failed: a route refusal carries its `reason`; a network failure has none. */
export interface McpLoadFailure {
  error: string;
  reason?: McpRefusalReason;
  /** No answer within `MCP_OVERVIEW_TIMEOUT_MS`; the request was aborted. */
  timedOut?: boolean;
}

/**
 * How long a load may take, both requests included. Refresh is disabled while
 * one runs, so without a deadline a request that never answers (a stalled
 * compile, a slow scan of large skill folders) would leave the panel loading
 * with no way to retry until Settings is closed.
 */
export const MCP_OVERVIEW_TIMEOUT_MS = 15_000;

export type McpLoadResult =
  | {
      ok: true;
      data: McpResponse;
      /** The route refused the project folder, so only the global file was read. */
      projectError?: McpLoadFailure;
    }
  | { ok: false; error: McpLoadFailure };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * A refusal's diagnostic and reason code (with the file and server it names,
 * and what an add refusal carries), or the HTTP status when the body has none.
 */
export function refusalFailure(data: unknown, status: number): McpActionFailure {
  const refusal = (data ?? {}) as Partial<Record<keyof McpErrorResponse, unknown>>;
  const breadth = refusal.breadth as Partial<FreshFolderTrustBreadth> | undefined;
  const trust = refusal.trust as Partial<ProjectTrustStatus> | undefined;
  return {
    error: typeof refusal.error === "string" ? refusal.error : `HTTP ${status}`,
    ...(typeof refusal.reason === "string" ? { reason: refusal.reason as McpRefusalReason } : {}),
    ...(typeof refusal.path === "string" ? { path: refusal.path } : {}),
    ...(typeof refusal.name === "string" ? { name: refusal.name } : {}),
    ...(typeof refusal.suggestedName === "string" ? { suggestedName: refusal.suggestedName } : {}),
    ...(isStringList(refusal.names) ? { names: refusal.names } : {}),
    ...(isStringList(refusal.fields) ? { fields: refusal.fields } : {}),
    ...(Array.isArray(refusal.notes) ? { notes: refusal.notes.filter((note): note is McpImportNote => typeof note?.code === "string") } : {}),
    ...(typeof breadth?.kind === "string" && typeof breadth.path === "string" ? { breadth: breadth as FreshFolderTrustBreadth } : {}),
    ...(typeof trust?.requiresTrust === "boolean" && typeof trust.trusted === "boolean" ? { trust: trust as ProjectTrustStatus } : {}),
    ...(refusal.trustKept === true ? { trustKept: true } : {}),
  };
}

/**
 * Runs `run` until `timeoutMs`, then settles with `timedOut()` and aborts the
 * signal `run` was given, unless `abortAtDeadline` is false: then the request
 * goes on unanswered, for a route whose work must not stop because the panel
 * stopped waiting. The caller's `signal` is forwarded by hand, not with
 * `AbortSignal.any()`, which Safari supports only from 17.4 (this app
 * supports 16.2). The deadline resolves the race itself, so a fetch that
 * ignores its signal cannot outlast it.
 */
export async function withinDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timedOut: () => T,
  timeoutMs: number,
  signal?: AbortSignal,
  { abortAtDeadline = true }: { abortAtDeadline?: boolean } = {},
): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      // Settled before aborting, so the aborted fetch's failure cannot win the race.
      resolve(timedOut());
      if (abortAtDeadline) controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

function isMcpResponse(value: unknown): value is McpResponse {
  if (value === null || typeof value !== "object") return false;
  const data = value as Partial<McpResponse>;
  return typeof data.mcp === "object" && data.mcp !== null && typeof data.codemode === "object" && data.codemode !== null
    && Array.isArray(data.files) && Array.isArray(data.servers);
}

/** The URL of the overview: the global file alone without a project. */
export function mcpOverviewUrl(cwd: string | null): string {
  return cwd ? `/api/mcp?cwd=${encodeURIComponent(cwd)}` : "/api/mcp";
}

async function requestMcpOverview(cwd: string | null, fetchImpl: FetchLike, signal?: AbortSignal): Promise<McpLoadResult> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(mcpOverviewUrl(cwd), { cache: "no-store", signal });
  } catch (error) {
    return { ok: false, error: { error: error instanceof Error ? error.message : String(error) } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { error: `HTTP ${response.status}` } };
  }
  if (response.ok && isMcpResponse(data)) return { ok: true, data };
  return { ok: false, error: refusalFailure(data, response.status) };
}

const CWD_REFUSALS = new Set<McpRefusalReason>(["cwd-invalid", "cwd-denied", "cwd-not-directory"]);

async function loadWithin(cwd: string | null, fetchImpl: FetchLike, signal: AbortSignal): Promise<McpLoadResult> {
  const first = await requestMcpOverview(cwd, fetchImpl, signal);
  if (first.ok || !cwd || !first.error.reason || !CWD_REFUSALS.has(first.error.reason)) return first;
  const global = await requestMcpOverview(null, fetchImpl, signal);
  return global.ok ? { ...global, projectError: first.error } : global;
}

/**
 * Loads the overview for the panel's project, or the global file alone without
 * one. A project folder the route refuses (removed since, or outside the
 * folders Pi Web may read) does not hide the global servers: they are loaded
 * again without it, and the refusal is kept for the Project group to explain.
 * The whole load ends by `timeoutMs`, aborting what is still on its way
 * (`withinDeadline()`).
 */
export async function loadMcpOverview(
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_OVERVIEW_TIMEOUT_MS,
): Promise<McpLoadResult> {
  return withinDeadline<McpLoadResult>(
    (deadlineSignal) => loadWithin(cwd, fetchImpl, deadlineSignal),
    () => ({ ok: false, error: { error: `GET /api/mcp did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Saving the Code mode choice
// ---------------------------------------------------------------------------

/** How long a save may take; the switch is disabled meanwhile, as Refresh is during a load. */
export const MCP_CODEMODE_SAVE_TIMEOUT_MS = 15_000;

export type McpCodemodeSaveResult =
  | { ok: true; preference: McpCodemodePreference }
  | { ok: false; error: McpLoadFailure };

export type McpCodemodeModeSaveResult =
  | { ok: true; mode: CodemodeModeSetting }
  | { ok: false; error: McpLoadFailure };

export type McpCodemodeInlineBudgetSaveResult =
  | { ok: true; inlineBudget: CodemodeInlineBudgetSetting }
  | { ok: false; error: McpLoadFailure };

function isCodemodePreferenceValue(value: unknown): value is McpCodemodePreference {
  return value === "automatic" || value === "always";
}

function isCodemodeModeSetting(value: unknown): value is CodemodeModeSetting {
  if (value === null || typeof value !== "object") return false;
  const setting = value as Record<string, unknown>;
  return (setting.value === "on" || setting.value === "only")
    && (setting.invalid === undefined || typeof setting.invalid === "string");
}

function isInlineBudgetSetting(value: unknown): value is CodemodeInlineBudgetSetting {
  if (value === null || typeof value !== "object") return false;
  const setting = value as Record<string, unknown>;
  return (setting.value === undefined || typeof setting.value === "number")
    && (setting.invalid === undefined || typeof setting.invalid === "string");
}

/**
 * One change through `PUT /api/tools/settings`, answered with the value the
 * route read back after writing (picked from its answer by `stored`), which
 * is what the pane shows.
 */
async function requestToolSettingsChange<T>(
  change: Record<string, unknown>,
  stored: (data: Record<string, unknown>) => T | undefined,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<{ ok: true; stored: T } | { ok: false; error: McpLoadFailure }> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl("/api/tools/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    return { ok: false, error: { error: error instanceof Error ? error.message : String(error) } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { error: `HTTP ${response.status}` } };
  }
  const value = response.ok && data !== null && typeof data === "object" ? stored(data as Record<string, unknown>) : undefined;
  if (value !== undefined) return { ok: true, stored: value };
  return { ok: false, error: refusalFailure(data, response.status) };
}

async function requestCodemodeSave(
  preference: McpCodemodePreference,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<McpCodemodeSaveResult> {
  const result = await requestToolSettingsChange(
    { codemode: preference },
    (data) => (isCodemodePreferenceValue(data.codemode) ? data.codemode : undefined),
    fetchImpl,
    signal,
  );
  return result.ok ? { ok: true, preference: result.stored } : result;
}

/**
 * Saves the Code mode choice through `PUT /api/tools/settings`, the only
 * writer of the global `defaultTools` (it shares its lock with the PowerShell
 * switch). A timed-out save may still land on the server, so the caller reads
 * the overview again afterwards either way.
 */
export async function saveMcpCodemodePreference(
  preference: McpCodemodePreference,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_CODEMODE_SAVE_TIMEOUT_MS,
): Promise<McpCodemodeSaveResult> {
  return withinDeadline<McpCodemodeSaveResult>(
    (deadlineSignal) => requestCodemodeSave(preference, fetchImpl, deadlineSignal),
    () => ({ ok: false, error: { error: `PUT /api/tools/settings did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
  );
}

/**
 * Saves the global `codemode.mode` through `PUT /api/tools/settings`, which
 * writes it under the settings lock ("on", pi's default, removes the key). As
 * with the choice, the caller reads the overview again afterwards either way.
 */
export async function saveMcpCodemodeMode(
  mode: CodemodeMode,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_CODEMODE_SAVE_TIMEOUT_MS,
): Promise<McpCodemodeModeSaveResult> {
  return withinDeadline<McpCodemodeModeSaveResult>(
    async (deadlineSignal) => {
      const result = await requestToolSettingsChange(
        { codemodeMode: mode },
        (data) => (isCodemodeModeSetting(data.codemodeMode) ? data.codemodeMode : undefined),
        fetchImpl,
        deadlineSignal,
      );
      return result.ok ? { ok: true, mode: result.stored } : result;
    },
    () => ({ ok: false, error: { error: `PUT /api/tools/settings did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
  );
}

/**
 * Saves the global `codemode.inlineBudget` through `PUT /api/tools/settings`,
 * which writes it under the settings lock; null removes it, giving sessions
 * pi's default. As with the choice, the caller reads the overview again
 * afterwards either way.
 */
export async function saveMcpCodemodeInlineBudget(
  budget: number | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_CODEMODE_SAVE_TIMEOUT_MS,
): Promise<McpCodemodeInlineBudgetSaveResult> {
  return withinDeadline<McpCodemodeInlineBudgetSaveResult>(
    async (deadlineSignal) => {
      const result = await requestToolSettingsChange(
        { codemodeInlineBudget: budget },
        (data) => (isInlineBudgetSetting(data.codemodeInlineBudget) ? data.codemodeInlineBudget : undefined),
        fetchImpl,
        deadlineSignal,
      );
      return result.ok ? { ok: true, inlineBudget: result.stored } : result;
    },
    () => ({ ok: false, error: { error: `PUT /api/tools/settings did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Changing servers: POST /api/mcp
// ---------------------------------------------------------------------------

/**
 * Whether MCP being off leaves the panel read-only, as `POST /api/mcp`
 * decides: the operator turned it off (`PI_WEB_DISABLE_MCP`), or the SDK's
 * MCP modules cannot load, so nothing could be checked. `-builtin:mcp` does
 * not: a project can turn it back on, and whether a global switch works must
 * not depend on the folder Settings was opened from.
 */
export function mcpWritesOff(mcp: McpAvailability): boolean {
  return !mcp.available && mcp.reason !== "builtin-disabled";
}

/** Why the panel cannot change a server of a scope; each is also a refusal reason the route gives. */
export type McpWriteBlock = Extract<McpRefusalReason, "mcp-off" | "project-untrusted" | "trust-unreadable">;

/**
 * Why no server of `scope` can be changed here, or undefined when they can:
 * MCP is off (`mcpWritesOff()`), or for the project, no decision trusts it
 * (the rule sessions read its file by, `mcpProjectServersLoad()`) or
 * `trust.json` cannot be read.
 */
export function mcpWriteBlock(scope: McpScope, data: Pick<McpResponse, "mcp" | "project">): McpWriteBlock | undefined {
  if (mcpWritesOff(data.mcp)) return "mcp-off";
  if (scope === "project") {
    if (!data.project?.trust) return "trust-unreadable";
    if (!mcpProjectServersLoad(data.project)) return "project-untrusted";
  }
  return undefined;
}

/** The sentence a notice adds when what it reports also keeps the panel from changing servers. */
export const MCP_READ_ONLY_KEYS: Record<McpWriteBlock, string> = {
  "mcp-off": "mcp.readOnly.mcp-off",
  "project-untrusted": "mcp.readOnly.project-untrusted",
  "trust-unreadable": "mcp.readOnly.trust-unreadable",
};

type McpSwitchable = Pick<McpServerInfo, "enabled" | "webPasswordField" | "notAnObject">;

/** Whether a switch can change the entry at all: one that is not an object has no `enabled` to write. */
function mcpServerSwitchable(server: McpSwitchable): boolean {
  return server.notAnObject !== true;
}

/** Whether a switch may turn the entry on: the route refuses one that references PI_WEB_PASSWORD. */
function mcpServerCanTurnOn(server: McpSwitchable): boolean {
  return mcpServerSwitchable(server) && server.webPasswordField === undefined;
}

/**
 * What a group switch sends: the servers not already as asked, as
 * `itemsToSwitch()` picks them, except that one referencing PI_WEB_PASSWORD
 * is never turned on (the route refuses it) and an entry that is not an object
 * is never sent (nothing in it can be switched); `keptOff` counts the
 * PI_WEB_PASSWORD ones, for the note under the heading.
 */
export function mcpGroupSwitchTargets<T extends McpSwitchable>(servers: readonly T[], enabled: boolean): { targets: T[]; keptOff: number } {
  const sendable = enabled ? mcpServerCanTurnOn : mcpServerSwitchable;
  return {
    targets: itemsToSwitch(servers, enabled, (server) => server.enabled).filter(sendable),
    keptOff: enabled ? servers.filter((server) => !server.enabled && mcpServerSwitchable(server) && !mcpServerCanTurnOn(server)).length : 0,
  };
}

/**
 * Whether a group switch reads on: some server is on, and every server it
 * could turn on is. That is the Skills and Plugins rule (on only while every
 * row is) over the servers the switch can change: an entry referencing
 * PI_WEB_PASSWORD that is off, which it never turns on, or one that is not an
 * object would otherwise keep the group partial for good, so the switch would
 * always read off, every click would ask to turn it on and send nothing, and
 * the group could never be switched off from its heading.
 */
export function mcpGroupSwitchChecked(servers: readonly McpSwitchable[]): boolean {
  return servers.some((server) => server.enabled && mcpServerSwitchable(server))
    && servers.every((server) => server.enabled || !mcpServerCanTurnOn(server));
}

/** What the panel asks `POST /api/mcp` to do. */
export type McpActionRequest =
  | { action: "enable" | "disable" | "remove" | "sign-out"; scope: McpScope; name: string }
  | { action: "set-exposure"; scope: McpScope; name: string; exposure: NonNullable<McpServerInfo["exposure"]> }
  | { action: "set-enabled"; enabled: boolean; servers: McpServerRef[] }
  | { action: "undo"; token: string }
  | {
      action: "add";
      text: string;
      values: Record<string, McpImportFieldValue>;
      secretReferences?: Record<string, string>;
      server: number;
      name: string;
      scope: McpScope;
      rawPi: boolean;
      trustFolder?: boolean;
      confirmHostEnv?: string[];
    };

/** A refused change: the reason, plus the file and the server it names, and what a refused add says. */
export interface McpActionFailure extends McpLoadFailure {
  path?: string;
  name?: string;
  suggestedName?: string;
  names?: string[];
  fields?: string[];
  notes?: McpImportNote[];
  breadth?: FreshFolderTrustBreadth;
  trust?: ProjectTrustStatus;
  /** The add trusted the fresh folder and could not take that back after its write failed. */
  trustKept?: boolean;
}

export type McpActionResult = { ok: true; data: McpActionResponse } | { ok: false; error: McpActionFailure };

/** How long a change may take; the panel's controls wait meanwhile, as the Code mode switch does. */
export const MCP_ACTION_TIMEOUT_MS = 15_000;

async function requestMcpAction(body: Record<string, unknown>, fetchImpl: FetchLike, signal: AbortSignal): Promise<McpActionResult> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    return { ok: false, error: { error: error instanceof Error ? error.message : String(error) } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { error: `HTTP ${response.status}` } };
  }
  if (response.ok && isMcpResponse(data)) return { ok: true, data: data as McpActionResponse };
  return { ok: false, error: refusalFailure(data, response.status) };
}

/**
 * Sends a change to `POST /api/mcp`, whose answer is the overview after it.
 * `cwd` is the panel's project, sent only when the overview covers one (a
 * folder the route refused would refuse the change too, global ones
 * included). A change that times out may still land, so the caller reads the
 * overview again on any failure.
 */
export async function postMcpAction(
  request: McpActionRequest,
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_ACTION_TIMEOUT_MS,
): Promise<McpActionResult> {
  const body: Record<string, unknown> = { ...request, ...(cwd ? { cwd } : {}) };
  return withinDeadline<McpActionResult>(
    (deadlineSignal) => requestMcpAction(body, fetchImpl, deadlineSignal),
    () => ({ ok: false, error: { error: `POST /api/mcp did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Testing a server: POST /api/mcp/test
// ---------------------------------------------------------------------------

/**
 * Why Test cannot be used for a server, or undefined when it can. It is the
 * route's own check, so the button is never offered for a request that would
 * be refused: MCP off on the server (`mcpWritesOff()`; `-builtin:mcp` still
 * tests, as an explicit action), a project no decision trusts or a trust store
 * that cannot be read, an entry pi refuses, and one that references
 * PI_WEB_PASSWORD. A switched-off entry can be tested before it is turned on.
 */
export type McpTestBlock = McpWriteBlock | "invalid" | "web-password";

export const MCP_TEST_BLOCK_KEYS: Record<McpTestBlock, string> = {
  "mcp-off": "mcp.test.blocked.mcp-off",
  "project-untrusted": "mcp.test.blocked.project-untrusted",
  "trust-unreadable": "mcp.test.blocked.trust-unreadable",
  invalid: "mcp.test.blocked.invalid",
  "web-password": "mcp.test.blocked.web-password",
};

export function mcpTestBlock(
  server: Pick<McpServerInfo, "scope" | "invalidError" | "validated" | "webPasswordField">,
  data: Pick<McpResponse, "mcp" | "project">,
): McpTestBlock | undefined {
  const block = mcpWriteBlock(server.scope, data);
  if (block) return block;
  if (server.invalidError !== undefined || !server.validated) return "invalid";
  if (server.webPasswordField) return "web-password";
  return undefined;
}

/**
 * A refusal of the test route in the words of a test: the reasons the route
 * shares with the switches would otherwise say Pi Web "changes" nothing, or
 * that it left a file "unchanged" (`mcp.reason.*` is worded for writes).
 * `server-missing`, the `cwd-*` reasons and the request guards read the same
 * for both, and `internal` shows the route's diagnostic.
 */
export const MCP_TEST_REFUSAL_KEYS: Partial<Record<McpRefusalReason, string>> = {
  "mcp-off": "mcp.test.blocked.mcp-off",
  "project-untrusted": "mcp.test.blocked.project-untrusted",
  "trust-unreadable": "mcp.test.blocked.trust-unreadable",
  "server-invalid": "mcp.test.blocked.invalid",
  "web-password": "mcp.test.blocked.web-password",
  "entry-not-object": "mcp.test.refused.entry-not-object",
  "invalid-request": "mcp.test.refused.invalid-request",
  unparsable: "mcp.test.refused.unparsable",
  "invalid-shape": "mcp.test.refused.invalid-shape",
  "link-dangling": "mcp.test.refused.link-dangling",
  "link-outside": "mcp.test.refused.link-outside",
  "not-a-file": "mcp.test.refused.not-a-file",
  "too-large": "mcp.test.refused.too-large",
  "too-many-servers": "mcp.test.refused.too-many-servers",
};

/** What a test does, by how the server is reached; a server that runs a shell command adds `MCP_TEST_SERIAL_KEY`. */
export const MCP_TEST_SERIAL_KEY = "mcp.test.serial";

/** The state line of a test result: its label and tone; a deadline that passed reads as no answer. */
export function mcpTestStateView(result: Pick<McpTestResult, "state" | "timedOut">): { key: string; tone: McpStateTone } {
  if (result.timedOut) return { key: MCP_TEST_STATE_KEYS.timedOut, tone: "error" };
  return { key: MCP_TEST_STATE_KEYS[result.state], tone: mcpRowStateTone(result.state) };
}

export const MCP_TEST_STATE_KEYS: Record<McpTestResult["state"] | "timedOut", string> = {
  connected: "mcp.test.state.connected",
  "needs-auth": "mcp.test.state.needs-auth",
  failed: "mcp.test.state.failed",
  timedOut: "mcp.test.state.timedOut",
};

/** The sentence after the state: what was listed, or why nothing was, with when and how long. */
export const MCP_TEST_SUMMARY_KEYS: Record<McpTestResult["state"] | "timedOut", string> = {
  connected: "mcp.test.summary.connected",
  "needs-auth": "mcp.test.summary.needs-auth",
  failed: "mcp.test.summary.failed",
  timedOut: "mcp.test.summary.timedOut",
};

/** The same for the connection a sign-in made right after storing new tokens (`afterSignIn`), which no Test made. */
export const MCP_SIGN_IN_SUMMARY_KEYS: Record<McpTestResult["state"] | "timedOut", string> = {
  connected: "mcp.signIn.summary.connected",
  "needs-auth": "mcp.signIn.summary.needs-auth",
  failed: "mcp.signIn.summary.failed",
  timedOut: "mcp.signIn.summary.timedOut",
};

export function mcpTestSummaryKey(result: Pick<McpTestResult, "state" | "timedOut" | "afterSignIn">): string {
  return (result.afterSignIn ? MCP_SIGN_IN_SUMMARY_KEYS : MCP_TEST_SUMMARY_KEYS)[result.timedOut ? "timedOut" : result.state];
}

/** Milliseconds as seconds with one decimal, for `{seconds}`. */
export function mcpSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

/** A Test the panel started for one server (by `mcpServerKey()`): running, the route's last answer, or why the request failed. */
export interface McpTestRun {
  running: boolean;
  /** When the panel sent the request of the test running now, or of the last one (`Date.now()`). */
  startedAt?: number;
  /**
   * When a Sign out of the server last worked: an answer to a test the panel
   * sent before it found tokens that are gone, and is dropped.
   */
  signedOutAt?: number;
  /** The last answer, for the entry as the route read it (its `configKey`). */
  response?: McpTestResponse;
  /** The request failed, was refused, or timed out. */
  error?: McpActionFailure;
  /** The last press waited past the deadline for another test of a server that runs a shell command and never ran. */
  queueTimedOut?: boolean;
  /**
   * The entry `error` and `queueTimedOut` are about: the one the press was for
   * (a refusal names none), or the one the route read. Neither is shown for an
   * entry edited since.
   */
  configKey?: string;
}

/**
 * Where a test request leaves its run: an answer replaces the last one, unless
 * it never left the queue (it found nothing, so the last result stays shown
 * beside a note); a failed request keeps the last answer and says why.
 * `pressedConfigKey` is the entry the panel listed when Test was pressed.
 */
export function mcpTestRunAfter(previous: McpTestRun | undefined, result: McpTestRequestResult, pressedConfigKey?: string): McpTestRun {
  const signedOutAt = previous?.signedOutAt;
  const marks = {
    ...(previous?.startedAt !== undefined ? { startedAt: previous.startedAt } : {}),
    ...(signedOutAt !== undefined ? { signedOutAt } : {}),
  };
  // Sent before a Sign out that worked: whatever it found was found with the tokens it removed.
  if (signedOutAt !== undefined && (previous?.startedAt ?? 0) <= signedOutAt) return { running: false, ...marks };
  const kept = previous?.response ? { response: previous.response } : {};
  if (!result.ok) {
    return { running: false, ...marks, ...kept, error: result.error, ...(pressedConfigKey !== undefined ? { configKey: pressedConfigKey } : {}) };
  }
  if (result.data.result.queueTimedOut) return { running: false, ...marks, ...kept, queueTimedOut: true, configKey: result.data.configKey };
  return { running: false, ...marks, response: result.data };
}

/**
 * Where a Sign out that worked leaves the server's run: the kept answer goes,
 * since the route forgot what connections found and the overview carries no
 * status, so the answer would otherwise show over it as Connected; a test
 * still running stays running, and its answer is dropped when it comes
 * (`signedOutAt`). No run, nothing to change.
 */
export function mcpTestRunAfterSignOut(previous: McpTestRun | undefined, now: number): McpTestRun | undefined {
  if (!previous) return undefined;
  return {
    running: previous.running,
    ...(previous.startedAt !== undefined ? { startedAt: previous.startedAt } : {}),
    signedOutAt: now,
  };
}

/** A server's run as its pane shows it: a failure or a queue timeout about another version of the entry is left out. */
export function mcpTestRunFor(run: McpTestRun | undefined, server: Pick<McpServerInfo, "configKey">): McpTestRun | undefined {
  if (!run || run.configKey === undefined || run.configKey === server.configKey) return run;
  return { running: run.running, ...(run.response ? { response: run.response } : {}) };
}

/**
 * Whether a test's answer says the listing is out of date, so the panel loads
 * it again, as it does after a refused change: the route refused with a
 * reason (the server is gone, the file no longer parses, the project lost its
 * trust, MCP was turned off), or it tested other content than the listing
 * shows (the entry was edited outside the panel), whose result the listing
 * would otherwise never show. A request that failed or timed out says nothing
 * about the files.
 */
export function mcpTestAnswerOutdates(
  result: McpTestRequestResult,
  listed: Pick<McpServerInfo, "configKey"> | undefined,
): boolean {
  if (!result.ok) return result.error.reason !== undefined && !result.error.timedOut;
  return listed?.configKey !== result.data.configKey;
}

/**
 * The overview with what the panel's own tests found: a test's answer becomes
 * the server's status when it is about the entry the listing shows (same
 * `configKey`) and newer than the status the overview carries. A load that
 * started before the test finished then cannot hide its result, and a result
 * for an entry edited since is not shown for the edited one.
 */
export function mcpWithTestResults(data: McpResponse, runs: Readonly<Record<string, McpTestRun>>): McpResponse {
  let changed = false;
  const servers = data.servers.map((server) => {
    const response = runs[mcpServerKey(server)]?.response;
    if (!response || response.configKey !== server.configKey) return server;
    if (server.status && mcpStatusTime(server.status) >= response.result.testedAt) return server;
    changed = true;
    const status: McpServerStatus = { ...response.result, origin: "test" };
    return { ...server, status };
  });
  return changed ? { ...data, servers } : data;
}

/**
 * How long the panel waits for a test: the route's 20 s deadline, as long
 * again in the queue behind another test of a server that runs a shell
 * command, the close it waits for, and a `!command`, which blocks the server's
 * clock for up to 10 s. The request is not aborted then, nor when the panel
 * closes: the route stops a test once every request waiting for it has gone,
 * and records nothing, so an aborted request would lose the result. A test
 * that outlasts the wait therefore still finishes on the server, and its
 * result shows at the next load; only closing the page stops it.
 */
export const MCP_TEST_TIMEOUT_MS = 60_000;

export type McpTestRequestResult = { ok: true; data: McpTestResponse } | { ok: false; error: McpActionFailure };

function isMcpTestResponse(value: unknown): value is McpTestResponse {
  if (value === null || typeof value !== "object") return false;
  const data = value as Partial<McpTestResponse>;
  const result = data.result as Partial<McpTestResult> | undefined;
  return typeof data.configKey === "string" && typeof data.name === "string" && (data.scope === "global" || data.scope === "project")
    && typeof result === "object" && result !== null && typeof result.state === "string" && Array.isArray(result.tools)
    && typeof result.testedAt === "number";
}

async function requestMcpTest(body: Record<string, unknown>, fetchImpl: FetchLike, signal: AbortSignal): Promise<McpTestRequestResult> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl("/api/mcp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    return { ok: false, error: { error: error instanceof Error ? error.message : String(error) } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { error: `HTTP ${response.status}` } };
  }
  if (response.ok && isMcpTestResponse(data)) return { ok: true, data };
  return { ok: false, error: refusalFailure(data, response.status) };
}

/**
 * Asks `POST /api/mcp/test` to connect one server, which the route reads from
 * its file. `cwd` is the panel's project, sent only when the listing covers
 * one, as for a change: a project server needs it, and a global stdio server
 * runs in it (else in the home folder). At `timeoutMs` it answers `timedOut`
 * and leaves the request running (`MCP_TEST_TIMEOUT_MS`); only `signal`
 * aborts it.
 */
export async function postMcpTest(
  server: McpServerRef,
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_TEST_TIMEOUT_MS,
): Promise<McpTestRequestResult> {
  const body: Record<string, unknown> = { scope: server.scope, name: server.name, ...(cwd ? { cwd } : {}) };
  return withinDeadline<McpTestRequestResult>(
    (deadlineSignal) => requestMcpTest(body, fetchImpl, deadlineSignal),
    () => ({ ok: false, error: { error: `POST /api/mcp/test did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
    { abortAtDeadline: false },
  );
}
