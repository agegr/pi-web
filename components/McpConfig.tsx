"use client";

import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import type {
  McpActionResponse,
  McpCodemodeInfo,
  McpCodemodePreference,
  McpConfigFieldRef,
  McpResponse,
  McpScope,
  McpServerInfo,
  McpServerStatus,
  McpSessionStatus,
  ProjectTrustStatus,
} from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import {
  mcpFieldLabel,
  mcpFileProblemDetail,
  mcpServerHasHiddenCharacters,
  mcpServerTarget,
  mcpVariableChips,
  mcpVariableReferencesKey,
  revealHiddenCharacters,
} from "@/lib/mcp-server-display";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import { focusAfterChange, focusIfLost } from "@/lib/stacked-dialog";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigListAction,
  ConfigFooter,
  ConfigFooterStatus,
  ConfigNotice,
  ConfigPanelShell,
  ConfigScopeSwitch,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
  ConfigTrustNotice,
} from "./SettingsUi";
import {
  MCP_CODEMODE_SELECTION,
  MCP_CODEMODE_STATE_KEYS,
  MCP_EXPOSURE_KEYS,
  MCP_EXPOSURE_SHORT_KEYS,
  MCP_READ_ONLY_KEYS,
  MCP_ROW_STATE_BADGE_KEYS,
  MCP_TEST_BLOCK_KEYS,
  MCP_TEST_REFUSAL_KEYS,
  MCP_TEST_SERIAL_KEY,
  isBlockingFileProblem,
  loadMcpOverview,
  mcpCodemodeAlwaysUnavailableNotice,
  mcpCodemodeAutomaticNotice,
  mcpCodemodeBuiltinNotice,
  mcpCodemodeProjectOverrideNotice,
  mcpCodemodeReachNotice,
  mcpCodemodeRowState,
  mcpCodemodeTone,
  mcpEffectiveAutoEnableCodemode,
  mcpEmptyDetailKey,
  mcpFileProblems,
  mcpGroupCounts,
  mcpGroupEmptyKey,
  mcpGroupSwitchChecked,
  mcpGroupSwitchTargets,
  mcpProjectTrustable,
  mcpRowContext,
  mcpRowStateDetailKey,
  mcpRowStateLabelKey,
  mcpRowStateTone,
  mcpServerGroups,
  mcpSeconds,
  mcpServerKey,
  mcpServerRowState,
  mcpSessionStateView,
  mcpSessionSummaryKey,
  mcpStatusDot,
  mcpStatusTimeText,
  mcpTestAnswerOutdates,
  mcpTestBlock,
  mcpTestRunAfter,
  mcpTestRunAfterSignOut,
  mcpTestRunFor,
  mcpTestStateView,
  mcpTestSummaryKey,
  mcpTrustNotice,
  mcpUnavailableNotice,
  mcpWithTestResults,
  mcpWriteBlock,
  mcpWritesOff,
  pickMcpSelection,
  postMcpAction,
  postMcpTest,
  saveMcpCodemodePreference,
  withMcpCodemodePreference,
  type McpActionFailure,
  type McpActionRequest,
  type McpActionResult,
  type McpAutoEnableCodemode,
  type McpLoadFailure,
  type McpNoticeText,
  type McpRowContext,
  type McpServerGroup,
  type McpTestBlock,
  type McpTestRun,
  type McpWriteBlock,
} from "./mcp-config-helpers";
import { McpAddServer, type McpAddActionRequest } from "./McpAddServer";
import { EMPTY_MCP_ADD_DRAFT, type McpAddDraft } from "./mcp-add-helpers";
import { McpSignInRow } from "./McpSignIn";
import {
  MCP_SIGN_IN_POLL_MS,
  cancelMcpSignInFlow,
  getMcpSignIn,
  mcpSignInActive,
  mcpSignInBlock,
  mcpSignInJustEnded,
  mcpSignInRunAfterCancel,
  mcpSignInRunAfterPaste,
  mcpSignInRunAfterPoll,
  mcpSignInRunAfterStart,
  mcpSignOutBlock,
  pasteMcpSignIn,
  postMcpSignIn,
  type McpSignInRun,
} from "./mcp-sign-in-helpers";
import { projectTrustReloadKey } from "./settings-ui-helpers";

type Translate = ReturnType<typeof useI18n>["t"];

/** What the panel has loaded; a project the route refused leaves the global listing and `projectError`. */
export type McpConfigLoad =
  | { state: "loading" }
  | { state: "failed"; error: McpLoadFailure }
  | { state: "loaded"; data: McpResponse; projectError?: McpLoadFailure };

function scopeLabel(scope: McpScope, t: Translate): string {
  return scope === "project" ? t("skills.scope.project") : t("skills.scope.global");
}

/** A path as the panel shows it: the home folder as `~`, hidden characters escaped. */
function displayPath(path: string): string {
  return revealHiddenCharacters(shortenPath(path));
}

/** A notice's text, with any `path` parameter shown as `displayPath()` shows it. */
function noticeText({ key, params }: McpNoticeText, t: Translate): string {
  if (!params) return t(key);
  return t(key, params.path === undefined ? params : { ...params, path: displayPath(params.path) });
}

/** A refusal's translated reason, or for an internal or network failure its diagnostic. */
function failureText(failure: McpLoadFailure, t: Translate): string {
  if (failure.timedOut) return t("mcp.loadTimedOut");
  return failure.reason && failure.reason !== "internal" ? t(`mcp.reason.${failure.reason}`) : failure.error;
}

/** The same for a change, whose timeout means it may have landed. */
function actionFailureText(failure: McpActionFailure, t: Translate): string {
  if (failure.timedOut) return t("mcp.actionTimedOut");
  return failureText(failure, t);
}

/** What saving the Code mode choice is doing: nothing, waiting for the route, or why it failed. */
export interface McpCodemodeSaveState {
  saving: boolean;
  error: McpLoadFailure | null;
}

/** What the last group switch left undone, under that group's heading. */
export interface McpGroupStatus {
  scope: McpScope;
  /** Servers that reference PI_WEB_PASSWORD, which the switch left off. */
  keptOff: number;
  /** The servers the route refused, of `total` asked for. */
  failures: { name: string; failure: McpActionFailure }[];
  total: number;
  /** The request as a whole failed. */
  error?: McpActionFailure;
}

/**
 * A removal that can still be undone, while its notice shows: the token the
 * route answered with, never the entry, which stays on the server.
 */
export interface McpUndoNotice {
  token: string;
  scope: McpScope;
  name: string;
  path: string;
  /** How long the route holds it, from when the notice appeared. */
  expiresInMs: number;
  undoing: boolean;
  error?: McpActionFailure;
}

/** What the last Add wrote, while its notice shows: the server, its file, and the folder it trusted. */
export interface McpAddedNotice {
  scope: McpScope;
  name: string;
  path: string;
  key: string;
  /** The project folder the Add trusted in the same step. */
  trustedFolder?: string;
}

/**
 * Where focus goes once a change is answered and nothing waits any more: the
 * button it was started from (disabled meanwhile, which dropped focus to the
 * page). A new object per change, so the same button twice still counts.
 */
export interface McpFocusBack {
  control: HTMLButtonElement | null;
  /**
   * The change took its control away with the pane it sat in (an Add that
   * worked, whether its button or Cmd/Ctrl+Enter in the box started it):
   * focus goes to the selected row once it fell to the page.
   */
  toSelectedRow?: boolean;
}

/** The button a change is started from, when it has focus: a keyboard press, or a click in most browsers. */
function pressedButton(): HTMLButtonElement | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  return active instanceof HTMLButtonElement ? active : null;
}

/**
 * Settings › MCP: the servers of the global `mcp.json` and, with a project,
 * its `.pi/mcp.json`, from `GET /api/mcp`, which reads the files and nothing
 * else: no server is started or contacted to show this. Works without a
 * project; the Project group appears only with one. A server can be switched
 * on or off, a whole group at once, and removed with 60 seconds to undo,
 * through `POST /api/mcp`, whose answer is the overview after the change; open
 * sessions apply it at their next message. Test connects one server once
 * through `POST /api/mcp/test`, beside any change, and its result becomes the
 * row's state. An OAuth server signs in through `/api/mcp/sign-in`, whose
 * flow lives on the server and is polled here, and signs out through
 * `POST /api/mcp`. The Code mode choice is written through
 * `PUT /api/tools/settings`. An untrusted project's notice offers
 * Trust, which opens the page's trust dialog (AppShell owns trust), and the
 * panel reloads once the page's status for the folder changes. Add MCP server
 * opens the paste pane (`McpAddServer`); an Add that worked selects the new
 * server, tests it once, offers Sign in when it asks for one, and hands the
 * folder's new trust to the page when a project server was added.
 */
export function McpConfig({
  cwd,
  onClose,
  embedded = false,
  trust,
  onTrustProject,
  onProjectTrustChanged,
}: {
  cwd: string | null;
  onClose: () => void;
  embedded?: boolean;
  /** The page's trust status for `cwd`; a change reloads the panel. */
  trust?: ProjectTrustStatus | null;
  /** Opens the page's trust dialog for `cwd`; without it the trust notice has no button. */
  onTrustProject?: () => void;
  /** Hands the page `cwd`'s trust after an Add wrote to its `.pi/mcp.json` (and maybe trusted it). */
  onProjectTrustChanged?: (cwd: string, status: ProjectTrustStatus) => void;
}) {
  const [load, setLoad] = useState<McpConfigLoad>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("mcp", cwd));
  const [codemodeSave, setCodemodeSave] = useState<McpCodemodeSaveState>({ saving: false, error: null });
  // Which change is on its way (`switch:<key>`, `remove:<key>`, `sign-out:<key>`, `group:<scope>`, `undo`); one at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<McpActionErrorState | null>(null);
  const [groupStatus, setGroupStatus] = useState<McpGroupStatus | null>(null);
  const [undo, setUndo] = useState<McpUndoNotice | null>(null);
  const [focusBack, setFocusBack] = useState<McpFocusBack | null>(null);
  // Tests by server key. A test writes no file, so it runs beside changes and other tests.
  const [tests, setTests] = useState<Record<string, McpTestRun>>({});
  // A later load (Refresh, or the panel's project changing) wins over an earlier one still on its way.
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);
  // The test request on its way for each server, by key; an entry is only an identity.
  const testRequestsRef = useRef(new Map<string, object>());
  // Sign-ins by server key. A sign-in writes mcp-auth.json, never mcp.json, so it runs beside
  // changes, as a Test does; its flow lives on the server, and the panel only polls it.
  const [signIns, setSignIns] = useState<Record<string, McpSignInRun>>({});
  const signInsRef = useRef(signIns);
  signInsRef.current = signIns;
  const [pollRound, setPollRound] = useState(0);
  // The add pane: open or not, what was typed (kept while another row is shown), why the last Add was refused, and what it added.
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<McpAddDraft>(EMPTY_MCP_ADD_DRAFT);
  // The draft as it stands now, for an Add's answer to tell whether it is still about it: the pane
  // stays editable while the request is out, and every change makes a new draft object.
  const addDraftRef = useRef(addDraft);
  addDraftRef.current = addDraft;
  const [addFailure, setAddFailure] = useState<McpActionFailure | null>(null);
  const [added, setAdded] = useState<McpAddedNotice | null>(null);
  const mountedRef = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(true);
    const result = await loadMcpOverview(cwd, undefined, controller.signal);
    if (request !== requestRef.current) return;
    setRefreshing(false);
    if (!result.ok) {
      setLoad({ state: "failed", error: result.error });
      return;
    }
    setLoad({ state: "loaded", data: result.data, ...(result.projectError ? { projectError: result.projectError } : {}) });
    setSelected((current) => pickMcpSelection(mcpServerGroups(result.data, Boolean(cwd)), current));
  }, [cwd]);

  // A new trust decision for the folder (the trust dialog trusted it, or read
  // one made elsewhere) loads the panel again, in place, so the project's
  // servers and notices follow while the selection stays.
  const trustKey = projectTrustReloadKey(trust);
  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [refresh, trustKey]);

  // The switch is disabled while a save or a server change runs, so only one write is ever on its way.
  const saveCodemode = useCallback(async (preference: McpCodemodePreference) => {
    const controller = new AbortController();
    saveControllerRef.current = controller;
    setCodemodeSave({ saving: true, error: null });
    const result = await saveMcpCodemodePreference(preference, undefined, controller.signal);
    // Closed meanwhile: nothing is left to update.
    if (saveControllerRef.current !== controller) return;
    saveControllerRef.current = null;
    setCodemodeSave({ saving: false, error: result.ok ? null : result.error });
    if (result.ok) {
      setLoad((current) => current.state === "loaded"
        ? { ...current, data: withMcpCodemodePreference(current.data, result.preference) }
        : current);
    }
    // Read back what is stored: a save that timed out may still land, and one
    // refused because the file no longer parses should show that file's error.
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const testRequests = testRequestsRef.current;
    mountedRef.current = true;
    return () => {
      // Sign-ins are let go too: they go on on the server, and Sign in joins one again.
      mountedRef.current = false;
      saveControllerRef.current?.abort();
      saveControllerRef.current = null;
      actionControllerRef.current?.abort();
      actionControllerRef.current = null;
      // Tests are let go, never aborted: the route stops a test nobody waits
      // for and records nothing, while one left running records its result
      // for the next time Settings opens.
      testRequests.clear();
    };
  }, []);

  // One test per server at a time; the route joins presses from other tabs too.
  // Its answer is kept per server and shown over the listing's status while it
  // is the newer one (`mcpWithTestResults()`), so a load already on its way
  // cannot hide it. An answer that shows the listing is out of date (a
  // refusal, or a test of content the listing does not show) loads it again.
  const testServer = useCallback(async (server: McpServerInfo) => {
    const key = mcpServerKey(server);
    if (testRequestsRef.current.has(key)) return;
    const request = {};
    testRequestsRef.current.set(key, request);
    setTests((runs) => ({ ...runs, [key]: { ...runs[key], running: true, startedAt: Date.now(), error: undefined, queueTimedOut: undefined, configKey: undefined } }));
    const current = loadRef.current;
    // As for a change: the project only when the listing covers it. A global stdio server runs there, else in the home folder.
    const testCwd = current.state === "loaded" && current.data.project ? cwd : null;
    const result = await postMcpTest({ scope: server.scope, name: server.name }, testCwd);
    // Closed meanwhile: nothing is left to update.
    if (testRequestsRef.current.get(key) !== request) return;
    testRequestsRef.current.delete(key);
    setTests((runs) => ({ ...runs, [key]: mcpTestRunAfter(runs[key], result, server.configKey) }));
    const listing = loadRef.current;
    const listed = listing.state === "loaded" ? listing.data.servers.find((item) => mcpServerKey(item) === key) : undefined;
    if (mcpTestAnswerOutdates(result, listed)) void refresh();
  }, [cwd, refresh]);

  // A change answers with the overview read after it, which replaces the
  // listing; a load still on its way may predate the change, so it is dropped.
  const applyOverview = useCallback((data: McpResponse, select?: string) => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    setRefreshing(false);
    setLoad((current) => ({
      state: "loaded",
      data,
      ...(current.state === "loaded" && current.projectError ? { projectError: current.projectError } : {}),
    }));
    setSelected((current) => pickMcpSelection(mcpServerGroups(data, Boolean(cwd)), select ?? current));
  }, [cwd]);

  // Sign in: the route starts the flow (or joins the one under way for the
  // server's URL) and answers at once. A refusal with a reason may mean the
  // listing is out of date, as for a test.
  const startSignIn = useCallback(async (server: McpServerInfo) => {
    const key = mcpServerKey(server);
    const current = signInsRef.current[key];
    if (current?.starting || mcpSignInActive(current)) return;
    setSignIns((runs) => ({ ...runs, [key]: { starting: true } }));
    const listing = loadRef.current;
    // As for Test: the project only when the listing covers it.
    const signInCwd = listing.state === "loaded" && listing.data.project ? cwd : null;
    const result = await postMcpSignIn({ scope: server.scope, name: server.name }, signInCwd);
    if (!mountedRef.current) return;
    setSignIns((runs) => ({ ...runs, [key]: mcpSignInRunAfterStart(result) }));
    if (!result.ok && result.error.reason !== undefined && !result.error.timedOut) void refresh();
  }, [cwd, refresh]);

  const pasteSignIn = useCallback(async (server: McpServerInfo, flowId: string, value: string) => {
    const key = mcpServerKey(server);
    setSignIns((runs) => (runs[key]?.flow?.flowId === flowId
      ? { ...runs, [key]: { ...runs[key], pasting: true, pasteError: undefined } }
      : runs));
    const result = await pasteMcpSignIn(flowId, value);
    if (!mountedRef.current) return;
    setSignIns((runs) => {
      const next = mcpSignInRunAfterPaste(runs[key], flowId, result);
      return next === undefined || next === runs[key] ? runs : { ...runs, [key]: next };
    });
  }, []);

  const cancelSignIn = useCallback(async (server: McpServerInfo, flowId: string) => {
    const key = mcpServerKey(server);
    setSignIns((runs) => (runs[key]?.flow?.flowId === flowId ? { ...runs, [key]: { ...runs[key], cancelling: true } } : runs));
    const result = await cancelMcpSignInFlow(flowId);
    if (!mountedRef.current) return;
    setSignIns((runs) => {
      const next = mcpSignInRunAfterCancel(runs[key], flowId, result);
      return next === undefined || next === runs[key] ? runs : { ...runs, [key]: next };
    });
  }, []);

  // While a sign-in runs, the panel asks where it stands about once a second:
  // the flow moves on by itself when the browser reaches the loopback
  // listener. A round ends with a new round number, which schedules the next.
  const activeFlowsKey = Object.entries(signIns)
    .flatMap(([key, run]) => (mcpSignInActive(run) && run.flow ? [`${key}\u0001${run.flow.flowId}`] : []))
    .join("\u0002");
  useEffect(() => {
    if (!activeFlowsKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      for (const item of activeFlowsKey.split("\u0002")) {
        const [key, flowId] = item.split("\u0001");
        // A paste or cancel answered while this poll is out is newer than what it brings back.
        const sentVersion = signInsRef.current[key]?.version ?? 0;
        const result = await getMcpSignIn(flowId, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setSignIns((runs) => {
          const next = mcpSignInRunAfterPoll(runs[key], flowId, result, Date.now(), sentVersion);
          return next === undefined || next === runs[key] ? runs : { ...runs, [key]: next };
        });
      }
      setPollRound((round) => round + 1);
    }, MCP_SIGN_IN_POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeFlowsKey, pollRound]);

  // A sign-in that ended changed mcp-auth.json and recorded what connecting
  // found: the overview is read again, for Signed in and the Connection row.
  const previousSignInsRef = useRef(signIns);
  useEffect(() => {
    const previous = previousSignInsRef.current;
    previousSignInsRef.current = signIns;
    if (Object.keys(signIns).some((key) => mcpSignInJustEnded(previous[key], signIns[key]))) void refresh();
  }, [signIns, refresh]);

  // Every control waits while a change runs, so only one is ever on its way.
  // A refused change reloads the listing: the file may no longer say what the
  // panel showed (a server removed meanwhile, a file that no longer parses),
  // and a change that timed out may still have landed.
  const runAction = useCallback(async (
    request: McpActionRequest,
    busyKey: string,
    select?: (data: McpActionResponse) => string | undefined,
  ): Promise<McpActionResult | undefined> => {
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setBusy(busyKey);
    const current = loadRef.current;
    // The project only when the listing covers it: a folder the route refused would refuse the change too.
    const writeCwd = current.state === "loaded" && current.data.project ? cwd : null;
    const result = await postMcpAction(request, writeCwd, undefined, controller.signal);
    // Closed meanwhile: nothing is left to update.
    if (actionControllerRef.current !== controller) return undefined;
    actionControllerRef.current = null;
    setBusy(null);
    if (result.ok) applyOverview(result.data, select?.(result.data));
    else void refresh();
    return result;
  }, [applyOverview, cwd, refresh]);

  const switchServer = useCallback(async (server: McpServerInfo, enabled: boolean) => {
    const key = mcpServerKey(server);
    const pressed = pressedButton();
    setActionError(null);
    setGroupStatus(null);
    const result = await runAction({ action: enabled ? "enable" : "disable", scope: server.scope, name: server.name }, `switch:${key}`);
    if (!result) return;
    if (!result.ok) setActionError({ key, failure: result.error });
    setFocusBack({ control: pressed });
  }, [runAction]);

  // A removal that worked moves focus to Undo, and an undo that worked to the
  // row it put back (both in the view); only a failed one gives focus back to
  // the button pressed.
  const removeServer = useCallback(async (server: McpServerInfo) => {
    const key = mcpServerKey(server);
    const pressed = pressedButton();
    setActionError(null);
    setGroupStatus(null);
    const result = await runAction({ action: "remove", scope: server.scope, name: server.name }, `remove:${key}`);
    if (!result) return;
    if (!result.ok) {
      setActionError({ key, failure: result.error });
      setFocusBack({ control: pressed });
      return;
    }
    const removed = result.data.undo;
    if (removed) setUndo({ ...removed, undoing: false });
  }, [runAction]);

  const undoRemoval = useCallback(async () => {
    const notice = undo;
    if (!notice) return;
    const pressed = pressedButton();
    setActionError(null);
    setGroupStatus(null);
    setUndo({ ...notice, undoing: true, error: undefined });
    const result = await runAction(
      { action: "undo", token: notice.token },
      "undo",
      (data) => (data.restored ? mcpServerKey(data.restored) : undefined),
    );
    if (!result) return;
    setUndo((current) => {
      if (current?.token !== notice.token) return current;
      return result.ok ? null : { ...current, undoing: false, error: result.error };
    });
    if (!result.ok) setFocusBack({ control: pressed });
  }, [runAction, undo]);

  // Sign out deletes the URL's tokens from mcp-auth.json through POST /api/mcp,
  // which answers with the overview, like any change.
  const signOut = useCallback(async (server: McpServerInfo) => {
    const key = mcpServerKey(server);
    const pressed = pressedButton();
    setActionError(null);
    setGroupStatus(null);
    setSignIns((runs) => ({ ...runs, [key]: { ...runs[key], signOutError: undefined, signedOut: undefined } }));
    const result = await runAction({ action: "sign-out", scope: server.scope, name: server.name }, `sign-out:${key}`);
    if (!result) return;
    setSignIns((runs) => ({
      ...runs,
      [key]: result.ok ? { signedOut: { removed: result.data.signedOut?.removed === true } } : { ...runs[key], signOutError: result.error },
    }));
    // The route forgot what connections found; this panel's own test answers go too, or one would
    // read Connected over the untested entry until Settings closed.
    if (result.ok) {
      const now = Date.now();
      setTests((runs) => {
        const next = mcpTestRunAfterSignOut(runs[key], now);
        return next ? { ...runs, [key]: next } : runs;
      });
    }
    setFocusBack({ control: pressed });
  }, [runAction]);

  // Add writes through POST /api/mcp like any change, after the explicit click
  // that followed the preview; the server is then tested once, as the ADR has
  // it, and only then: an install link hides its command until the preview.
  const submitAdd = useCallback(async (request: McpAddActionRequest) => {
    const pressed = pressedButton();
    const sent = addDraftRef.current;
    setActionError(null);
    setGroupStatus(null);
    setAddFailure(null);
    const result = await runAction(request, "add", (data) => (data.added ? mcpServerKey(data.added) : undefined));
    if (!result) return;
    // Edited while the request was out: the answer is about the draft as it was sent.
    const edited = addDraftRef.current !== sent;
    if (!result.ok) {
      // A refusal of the old draft says nothing of the new one, and acting on it (the host-variable
      // confirmation, Use <name>) would send the new draft with the old answer's names.
      if (!edited) setAddFailure(result.error);
      // A folder that changed under the step: the page shows its trust as it is now.
      if (result.error.trust && cwd) onProjectTrustChanged?.(cwd, result.error.trust);
      setFocusBack({ control: pressed });
      return;
    }
    const { added: written, trust: writtenTrust, trustedFolder } = result.data;
    setAdding(false);
    // What was typed since is kept for the next Add rather than thrown away.
    if (!edited) setAddDraft(EMPTY_MCP_ADD_DRAFT);
    // The pane goes with its button and its box: focus moves to the new server's row, which the answer selected.
    setFocusBack({ control: null, toSelectedRow: true });
    if (!written) return;
    setAdded({ ...written, key: mcpServerKey(written), ...(trustedFolder && cwd ? { trustedFolder: cwd } : {}) });
    if (writtenTrust && cwd) onProjectTrustChanged?.(cwd, writtenTrust);
    const listed = result.data.servers.find((item) => mcpServerKey(item) === mcpServerKey(written));
    if (listed && !mcpTestBlock(listed, result.data)) void testServer(listed);
  }, [cwd, onProjectTrustChanged, runAction, testServer]);

  // The notice goes when the route lets the removal go.
  const undoToken = undo?.token;
  const undoExpiresInMs = undo?.expiresInMs;
  useEffect(() => {
    if (undoToken === undefined || undoExpiresInMs === undefined) return;
    const timer = setTimeout(() => setUndo((current) => (current?.token === undoToken ? null : current)), undoExpiresInMs);
    return () => clearTimeout(timer);
  }, [undoToken, undoExpiresInMs]);

  // One request for the whole group, answered per server: the ones the route
  // refuses keep their state and are named under the heading, and so are the
  // ones referencing PI_WEB_PASSWORD, which switching on leaves off.
  const switchGroup = useCallback(async (scope: McpScope, servers: McpServerInfo[], enabled: boolean) => {
    const { targets, keptOff } = mcpGroupSwitchTargets(servers, enabled);
    const pressed = pressedButton();
    setActionError(null);
    setGroupStatus(keptOff > 0 ? { scope, keptOff, failures: [], total: 0 } : null);
    if (targets.length === 0) return;
    const result = await runAction(
      { action: "set-enabled", enabled, servers: targets.map(({ scope: serverScope, name }) => ({ scope: serverScope, name })) },
      `group:${scope}`,
    );
    if (!result) return;
    setFocusBack({ control: pressed });
    if (!result.ok) {
      setGroupStatus({ scope, keptOff, failures: [], total: targets.length, error: result.error });
      return;
    }
    const results = result.data.results ?? [];
    const failures = results
      .filter((item) => item.reason !== undefined)
      .map((item) => ({ name: item.name, failure: { error: item.error ?? "", reason: item.reason } }));
    setGroupStatus(failures.length > 0 || keptOff > 0 ? { scope, keptOff, failures, total: results.length } : null);
  }, [runAction]);

  useEffect(() => {
    if (selected) setLastSettingsSelection("mcp", selected, cwd);
  }, [cwd, selected]);

  return (
    <McpConfigView
      cwd={cwd}
      load={load}
      selected={selected}
      refreshing={refreshing}
      embedded={embedded}
      codemodeSave={codemodeSave}
      busy={busy}
      actionError={actionError}
      groupStatus={groupStatus}
      undo={undo}
      focusBack={focusBack}
      tests={tests}
      signIns={signIns}
      adding={adding}
      addDraft={addDraft}
      addFailure={addFailure}
      added={added}
      onAddOpen={() => {
        setAdding(true);
        setAdded(null);
        setActionError(null);
      }}
      onAddDraftChange={(draft) => {
        addDraftRef.current = draft;
        setAddDraft(draft);
        // What was refused was about the draft as it stood.
        setAddFailure(null);
      }}
      onAddSubmit={(request) => void submitAdd(request)}
      onTest={(server) => void testServer(server)}
      onSignIn={(server) => void startSignIn(server)}
      onSignOut={(server) => void signOut(server)}
      onSignInPaste={(server, flowId, value) => void pasteSignIn(server, flowId, value)}
      onSignInCancel={(server, flowId) => void cancelSignIn(server, flowId)}
      onSelect={(key) => {
        setSelected(key);
        setActionError(null);
        setAdding(false);
        setAdded((current) => (current?.key === key ? current : null));
      }}
      onRefresh={() => void refresh()}
      onCodemodeChange={(preference) => void saveCodemode(preference)}
      onServerSwitch={(server, enabled) => void switchServer(server, enabled)}
      onGroupSwitch={(scope, servers, enabled) => void switchGroup(scope, servers, enabled)}
      onRemove={(server) => void removeServer(server)}
      onUndo={() => void undoRemoval()}
      onTrustProject={onTrustProject}
      onClose={onClose}
    />
  );
}

/** A change to one server that failed, shown in that server's detail pane. */
export interface McpActionErrorState {
  key: string;
  failure: McpActionFailure;
}

/** The panel for a load in any state, without the fetch; exported for tests. */
export function McpConfigView({
  cwd,
  load,
  selected,
  refreshing,
  embedded,
  codemodeSave = { saving: false, error: null },
  busy = null,
  actionError = null,
  groupStatus = null,
  undo = null,
  focusBack = null,
  tests = {},
  signIns = {},
  adding = false,
  addDraft = EMPTY_MCP_ADD_DRAFT,
  addFailure = null,
  added = null,
  onAddOpen = () => {},
  onAddDraftChange = () => {},
  onAddSubmit = () => {},
  onSelect,
  onRefresh,
  onCodemodeChange,
  onServerSwitch = () => {},
  onGroupSwitch = () => {},
  onRemove = () => {},
  onUndo = () => {},
  onTest = () => {},
  onSignIn = () => {},
  onSignOut = () => {},
  onSignInPaste = () => {},
  onSignInCancel = () => {},
  onTrustProject,
  onClose,
}: {
  cwd: string | null;
  load: McpConfigLoad;
  selected: string | null;
  refreshing: boolean;
  embedded: boolean;
  codemodeSave?: McpCodemodeSaveState;
  /** The change on its way, if any: `switch:<key>`, `remove:<key>`, `sign-out:<key>`, `group:<scope>` or `undo`. */
  busy?: string | null;
  actionError?: McpActionErrorState | null;
  groupStatus?: McpGroupStatus | null;
  undo?: McpUndoNotice | null;
  /** The control the last answered change was started from, to give focus back to. */
  focusBack?: McpFocusBack | null;
  /** The panel's tests by server key: running, their last answer, or why one failed. */
  tests?: Readonly<Record<string, McpTestRun>>;
  /** The panel's sign-ins by server key: starting, the flow as last polled, or why a request failed. */
  signIns?: Readonly<Record<string, McpSignInRun>>;
  /** The add pane is shown instead of the selected row's detail. */
  adding?: boolean;
  addDraft?: McpAddDraft;
  /** Why the route refused the last Add. */
  addFailure?: McpActionFailure | null;
  /** What the last Add wrote, for its notice. */
  added?: McpAddedNotice | null;
  onAddOpen?: () => void;
  onAddDraftChange?: (draft: McpAddDraft) => void;
  onAddSubmit?: (request: McpAddActionRequest) => void;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  onCodemodeChange: (preference: McpCodemodePreference) => void;
  onServerSwitch?: (server: McpServerInfo, enabled: boolean) => void;
  onGroupSwitch?: (scope: McpScope, servers: McpServerInfo[], enabled: boolean) => void;
  onRemove?: (server: McpServerInfo) => void;
  onUndo?: () => void;
  onTest?: (server: McpServerInfo) => void;
  onSignIn?: (server: McpServerInfo) => void;
  onSignOut?: (server: McpServerInfo) => void;
  onSignInPaste?: (server: McpServerInfo, flowId: string, value: string) => void;
  onSignInCancel?: (server: McpServerInfo, flowId: string) => void;
  onTrustProject?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const unavailableNoticeId = useId();
  const trustNoticeId = useId();
  // The panel's own test results count as each server's status while they are the newest.
  const data = load.state === "loaded" ? mcpWithTestResults(load.data, tests) : undefined;
  const groups = data ? mcpServerGroups(data, Boolean(cwd)) : [];
  const context = data ? mcpRowContext(data) : undefined;
  const servers = groups.flatMap((group) => group.servers);
  const selectedServer = servers.find((server) => mcpServerKey(server) === selected);
  const addedServer = added ? servers.find((server) => mcpServerKey(server) === added.key) : undefined;
  const unavailable = data ? mcpUnavailableNotice(data.mcp) : undefined;
  // MCP off says more: no session connects anything then.
  const hostInactive = unavailable ? undefined : data?.hostInactive;
  const projectFile = data?.files.find((file) => file.scope === "project");
  const trustNotice = data ? mcpTrustNotice(data.project, projectFile) : undefined;
  // Trust only where the dialog would offer it: the folder requires trust and is not trusted.
  const onTrust = onTrustProject && mcpProjectTrustable(data?.project) ? onTrustProject : undefined;
  const offersTrust = trustNotice?.kind === "untrusted" && onTrust !== undefined;
  // The trust dialog hands focus back to Trust… when it closes, and after a
  // successful trust the reload removes that button with its notice: focus
  // would fall to the page behind Settings. It goes to the selected row
  // instead, which the reload keeps; focus anywhere else stays where it is.
  // No row is selected while the add pane is open or the list is empty, so
  // every fallback ends at the Add MCP server action, on screen whenever the
  // overview has loaded.
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const addActionRef = useRef<HTMLButtonElement>(null);
  const focusFallback = () => selectedRowRef.current ?? addActionRef.current;
  const offeredTrustRef = useRef(offersTrust);
  useEffect(() => {
    const offeredTrust = offeredTrustRef.current;
    offeredTrustRef.current = offersTrust;
    if (offeredTrust && !offersTrust) focusIfLost(document, focusFallback());
  }, [offersTrust]);
  // A removal unmounts the pane its Remove button sat in, and a finished or
  // expired undo the notice its Undo button sat in, so focus would fall to the
  // page behind Settings: it moves to Undo once offered, and to the selected
  // row once the notice goes. Focus anywhere else stays where it is.
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const undoToken = undo?.token;
  const shownUndoRef = useRef(undoToken);
  useEffect(() => {
    const shown = shownUndoRef.current;
    shownUndoRef.current = undoToken;
    if (undoToken !== undefined && undoToken !== shown) focusIfLost(document, undoButtonRef.current);
    else if (shown !== undefined && undoToken === undefined) focusIfLost(document, focusFallback());
  }, [undoToken]);
  const problems = data ? mcpFileProblems(data.files) : [];
  const counts = mcpGroupCounts(servers);
  const globalFile = data?.files.find((file) => file.scope === "global");
  const autoEnable = data ? mcpEffectiveAutoEnableCodemode(data) : undefined;
  const emptyKey = data ? mcpEmptyDetailKey(servers.length, data.files) : undefined;
  // Every control waits while a change, a Code mode save or a load is on its way, so the listing a click
  // acts on is the one shown, and one write's answer never replaces what another just saved.
  const controlsBusy = busy !== null || refreshing || codemodeSave.saving;
  // Waiting disables the control a change was started from, and a disabled
  // element loses focus to the page behind Settings. Once nothing waits (a
  // refused change waits for its reload too), focus goes back to it, or to the
  // selected row when it went away or stays disabled; only when it fell to the
  // page. Declared after the Undo effects: a removal that worked gives Undo
  // focus, and a later fallback must not take it.
  const handledFocusBackRef = useRef<McpFocusBack | null>(null);
  useEffect(() => {
    if (!focusBack || controlsBusy || handledFocusBackRef.current === focusBack) return;
    handledFocusBackRef.current = focusBack;
    if (focusBack.toSelectedRow) focusIfLost(document, focusFallback());
    else focusAfterChange(document, focusBack.control, focusFallback());
  }, [focusBack, controlsBusy]);
  const writeBlock = (scope: McpScope): McpWriteBlock | undefined => (data ? mcpWriteBlock(scope, data) : undefined);
  const writesOff = data ? mcpWritesOff(data.mcp) : false;
  const projectServers = groups.find((group) => group.scope === "project")?.servers ?? [];
  const projectBlock = writeBlock("project");
  // The notices above the list say why a switch cannot be used; a disabled one points at them.
  const blockNoticeId = (block: McpWriteBlock | undefined) => {
    if (block === "mcp-off") return unavailable ? unavailableNoticeId : undefined;
    return block && trustNotice?.kind === "untrusted" ? trustNoticeId : undefined;
  };
  const trustMessage = trustNotice?.kind === "untrusted"
    ? [
        noticeText(trustNotice, t),
        projectBlock && projectBlock !== "mcp-off" && projectServers.length > 0 ? t(MCP_READ_ONLY_KEYS[projectBlock]) : null,
      ].filter(Boolean).join(" ")
    : "";

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("settings.mcp")}
      subtitle={cwd ? shortenPath(cwd) : undefined}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      {/* Up to six at once: they scroll in their own box, so the list and the pane keep most of the height. */}
      <div className="mcp-config-notices">
        {unavailable && (
          <ConfigNotice id={unavailableNoticeId}>
            {noticeText(unavailable, t)}
            {writesOff && <> {t(MCP_READ_ONLY_KEYS["mcp-off"])}</>}
            {data && !data.mcp.available && data.mcp.detail && (
              <> <code className="mcp-config-chip">{revealHiddenCharacters(data.mcp.detail)}</code></>
            )}
          </ConfigNotice>
        )}
        {hostInactive && (
          <ConfigNotice>{t("mcp.hostInactive", { path: displayPath(hostInactive.cwd), owner: displayPath(hostInactive.owner) })}</ConfigNotice>
        )}
        {load.state === "loaded" && load.projectError && (
          <ConfigNotice>{t("mcp.projectNotListed", { reason: failureText(load.projectError, t) })}</ConfigNotice>
        )}
        {trustNotice?.kind === "untrusted" && (
          <ConfigTrustNotice id={trustNoticeId} message={trustMessage} trustLabel={t("mcp.trust.trustButton")} onTrust={onTrust} />
        )}
        {trustNotice?.kind === "inherited" && <ConfigNotice>{noticeText(trustNotice, t)}</ConfigNotice>}
        {undo && (
          <ConfigNotice
            action={undo.error?.reason === "undo-unavailable" ? undefined : (
              <ConfigButton ref={undoButtonRef} size="small" onClick={onUndo} disabled={undo.undoing || controlsBusy}>
                {undo.undoing ? t("mcp.undoing") : t("mcp.undo")}
              </ConfigButton>
            )}
          >
            {t("mcp.removed", { name: revealHiddenCharacters(undo.name), path: displayPath(undo.path) })}
            {undo.error && <> {t("mcp.undoFailed")} {actionFailureText(undo.error, t)}</>}
          </ConfigNotice>
        )}
        {added && data && addedServer && (
          <McpAddedNoticeView
            added={added}
            cwd={cwd}
            server={addedServer}
            testing={tests[added.key]?.running === true}
            signIn={signIns[added.key]}
            signingOut={busy === `sign-out:${added.key}`}
            signInBlock={addedServer ? mcpSignInBlock(addedServer, data) : undefined}
            onSignIn={onSignIn}
          />
        )}
      </div>

      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {load.state === "loading" ? (
              <div className="config-sidebar-message">{t("i18n.loading")}</div>
            ) : load.state === "failed" ? (
              <div role="alert" className="config-sidebar-message is-error">
                {t("mcp.loadFailed")} {failureText(load.error, t)}
              </div>
            ) : data && context ? (
              <>
                {/* First, so the 190px phone sidebar always shows it, however many servers follow. */}
                <div className="config-sidebar-group">
                  <McpCodemodeRow
                    codemode={data.codemode}
                    active={!adding && selected === MCP_CODEMODE_SELECTION}
                    rowRef={selectedRowRef}
                    onSelect={onSelect}
                  />
                </div>
                {groups.map((group) => {
                  const block = writeBlock(group.scope);
                  return (
                    <McpServerGroupList
                      key={group.scope}
                      group={group}
                      context={context}
                      selected={adding ? null : selected}
                      selectedRowRef={selectedRowRef}
                      block={block}
                      blockNoticeId={blockNoticeId(block)}
                      busy={busy}
                      controlsBusy={controlsBusy}
                      status={groupStatus?.scope === group.scope ? groupStatus : null}
                      onSelect={onSelect}
                      onGroupSwitch={onGroupSwitch}
                    />
                  );
                })}
              </>
            ) : null}
          </ConfigSidebarList>
          {data && (
            <ConfigListAction ref={addActionRef} active={adding} onClick={onAddOpen}>
              {t("mcp.add.action")}
            </ConfigListAction>
          )}
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
            {!data || !context || !autoEnable || !emptyKey ? null : adding ? (
              <McpAddServer
                data={data}
                cwd={cwd}
                draft={addDraft}
                busy={busy === "add"}
                controlsBusy={controlsBusy}
                failure={addFailure}
                onDraftChange={onAddDraftChange}
                onSubmit={onAddSubmit}
                onTrustProject={onTrust}
              />
            ) : selected === MCP_CODEMODE_SELECTION ? (
              <McpCodemodeDetail
                codemode={data.codemode}
                autoEnable={autoEnable}
                save={codemodeSave}
                serverBusy={busy !== null}
                onChange={onCodemodeChange}
              />
            ) : selectedServer ? (
              <McpServerDetail
                key={mcpServerKey(selectedServer)}
                server={selectedServer}
                context={context}
                codemode={data.codemode}
                autoEnable={autoEnable}
                block={writeBlock(selectedServer.scope)}
                savedWhileOff={!data.mcp.available && !writesOff}
                busy={busy}
                controlsBusy={controlsBusy}
                actionError={actionError?.key === mcpServerKey(selectedServer) ? actionError.failure : null}
                test={mcpTestRunFor(tests[mcpServerKey(selectedServer)], selectedServer)}
                testBlock={mcpTestBlock(selectedServer, data)}
                signIn={signIns[mcpServerKey(selectedServer)]}
                signInBlock={mcpSignInBlock(selectedServer, data)}
                signOutBlock={mcpSignOutBlock(selectedServer, data)}
                onSwitch={onServerSwitch}
                onRemove={onRemove}
                onTest={onTest}
                onSignIn={onSignIn}
                onSignOut={onSignOut}
                onSignInPaste={onSignInPaste}
                onSignInCancel={onSignInCancel}
              />
            ) : (
              <ConfigEmptyState>
                {emptyKey === "mcp.empty"
                  ? t(emptyKey, { globalPath: displayPath(globalFile?.path ?? "~/.pi/agent/mcp.json") })
                  : t(emptyKey)}
              </ConfigEmptyState>
            )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter
        status={problems.length > 0 ? (
          <ConfigFooterStatus
            tone={problems.some(({ problem }) => isBlockingFileProblem(problem)) ? "error" : "warning"}
            summary={problems.length === 1 ? t("mcp.footer.fileProblem") : t("mcp.footer.fileProblems", { count: problems.length })}
            details={problems.map(({ file, problem }) => {
              const detail = mcpFileProblemDetail(problem, file.realPath);
              return (
                <>
                  <code className="mcp-config-chip">{displayPath(file.path)}</code>{" "}
                  {t(`mcp.fileProblem.${problem.reason}`)}
                  {detail && <> <code className="mcp-config-chip">{detail}</code></>}
                </>
              );
            })}
          />
        ) : (
          <ConfigFooterStatus summary={counts.total > 0 ? t("mcp.serverCount", { enabled: counts.enabled, total: counts.total }) : ""} />
        )}
      >
        {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
        <ConfigButton variant="secondary" onClick={onRefresh} disabled={controlsBusy}>
          {t("i18n.refresh")}
        </ConfigButton>
      </ConfigFooter>
    </ConfigPanelShell>
  );
}

/**
 * What the last Add wrote, above the list: the server and its file, the folder
 * it trusted in the same step, the test that follows, and Sign in when that
 * test found the server asks for one. A project file is named from the
 * panel's folder (`./.pi/mcp.json`), which the subtitle shows, and that folder
 * as "this folder", as the Add button named it: two absolute paths took a
 * quarter of a phone screen. The detail pane's File row keeps the full path.
 */
function McpAddedNoticeView({
  added,
  cwd,
  server,
  testing,
  signIn,
  signingOut,
  signInBlock,
  onSignIn,
}: {
  added: McpAddedNotice;
  /** The panel's project folder, which project paths are shown from. */
  cwd: string | null;
  /** The server as listed now; the notice goes once the file no longer defines it. */
  server: McpServerInfo;
  testing: boolean;
  signIn: McpSignInRun | undefined;
  /** A Sign out of the same server is on its way; it would cancel a sign-in started now on arrival. */
  signingOut: boolean;
  signInBlock: McpTestBlock | undefined;
  onSignIn: (server: McpServerInfo) => void;
}) {
  const { t } = useI18n();
  const name = revealHiddenCharacters(added.name);
  const path = added.scope === "project" && cwd ? revealHiddenCharacters(displayPathWithin(added.path, cwd)) : displayPath(added.path);
  const status = server.status;
  const asksSignIn = !testing && status?.origin === "test" && status.state === "needs-auth" && server.usesOAuth;
  const signingIn = signIn?.starting === true || mcpSignInActive(signIn);
  return (
    <ConfigNotice
      action={asksSignIn && !signingIn && !signingOut && !signInBlock ? (
        <ConfigButton size="small" variant="primary" onClick={() => onSignIn(server)}>
          {t("mcp.signIn.button")}
        </ConfigButton>
      ) : undefined}
    >
      {added.trustedFolder === undefined
        ? t("mcp.add.added", { name, path })
        : added.trustedFolder === cwd
          ? t("mcp.add.addedTrustedHere", { name, path })
          : t("mcp.add.addedTrusted", { name, path, folder: displayPath(added.trustedFolder) })}
      {testing && <> {t("mcp.add.testing")}</>}
      {asksSignIn && <> {t("mcp.add.needsSignIn")}</>}
    </ConfigNotice>
  );
}

function McpCodemodeRow({
  codemode,
  active,
  rowRef,
  onSelect,
}: {
  codemode: McpCodemodeInfo;
  active: boolean;
  /** Set to this row's button while it is the selected one. */
  rowRef: Ref<HTMLButtonElement>;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const state = mcpCodemodeRowState(codemode);
  const stateText = t(MCP_CODEMODE_STATE_KEYS[state]);
  return (
    <ConfigSidebarItem
      ref={active ? rowRef : undefined}
      active={active}
      aria-label={t("mcp.codemode.rowLabel", { state: stateText })}
      onClick={() => onSelect(MCP_CODEMODE_SELECTION)}
    >
      <ConfigStatusDot {...mcpStatusDot(mcpCodemodeTone(state))} />
      <ConfigSidebarText className="is-grow">{t("mcp.codemode.title")}</ConfigSidebarText>
      <span className={`mcp-sidebar-badge is-${mcpCodemodeTone(state)}`}>{stateText}</span>
    </ConfigSidebarItem>
  );
}

/** What a group switch left undone, as the lines under the group's heading. */
function groupStatusText(status: McpGroupStatus, t: Translate): { note?: string; error?: string } {
  const note = status.keptOff > 0 ? t("mcp.groupKeptOff", { count: status.keptOff }) : undefined;
  const error = status.error
    ? `${t("mcp.actionFailed")} ${actionFailureText(status.error, t)}`
    : status.failures.length > 0
      ? [
          t("mcp.bulkFailed", { count: status.failures.length, total: status.total }),
          ...status.failures.map(({ name, failure }) => `${revealHiddenCharacters(name)}: ${actionFailureText(failure, t)}`),
        ].join("\n")
      : undefined;
  return { ...(note ? { note } : {}), ...(error ? { error } : {}) };
}

function McpServerGroupList({
  group,
  context,
  selected,
  selectedRowRef,
  block,
  blockNoticeId,
  busy,
  controlsBusy,
  status,
  onSelect,
  onGroupSwitch,
}: {
  group: McpServerGroup;
  context: McpRowContext;
  selected: string | null;
  /** Set to the selected row's button, when it is in this group. */
  selectedRowRef: Ref<HTMLButtonElement>;
  /** Why the group's servers cannot be changed here. */
  block: McpWriteBlock | undefined;
  /** The notice above the list that says so. */
  blockNoticeId: string | undefined;
  busy: string | null;
  controlsBusy: boolean;
  status: McpGroupStatus | null;
  onSelect: (key: string) => void;
  onGroupSwitch: (scope: McpScope, servers: McpServerInfo[], enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const { enabled, total } = mcpGroupCounts(group.servers);
  // On only while every server it can turn on is: a partial group reads as off beside its count, and one
  // click completes it; an entry it never turns on (PI_WEB_PASSWORD, not an object) cannot hold it off.
  const checked = mcpGroupSwitchChecked(group.servers);
  const emptyKey = mcpGroupEmptyKey(group);
  const statusText = status ? groupStatusText(status, t) : undefined;
  return (
    <div className="config-sidebar-group">
      <ConfigSidebarGroupLabel
        aside={total > 0 ? (
          <ConfigSidebarGroupSwitch
            enabled={enabled}
            total={total}
            checked={checked}
            disabled={controlsBusy || block !== undefined}
            loading={busy === `group:${group.scope}`}
            describedBy={block ? blockNoticeId : undefined}
            label={t(checked ? "mcp.groupSwitchOn" : "mcp.groupSwitchOff", { group: scopeLabel(group.scope, t) })}
            onChange={(next) => onGroupSwitch(group.scope, group.servers, next)}
          />
        ) : undefined}
      >
        {scopeLabel(group.scope, t)}
      </ConfigSidebarGroupLabel>
      {statusText && <ConfigSidebarGroupStatus note={statusText.note} error={statusText.error} />}
      {emptyKey && <div className="mcp-sidebar-group-empty">{t(emptyKey)}</div>}
      {group.servers.map((server) => {
        const key = mcpServerKey(server);
        const state = mcpServerRowState(server, context);
        const tone = mcpRowStateTone(state);
        const badgeKey = MCP_ROW_STATE_BADGE_KEYS[state];
        const name = revealHiddenCharacters(server.name);
        return (
          <ConfigSidebarItem
            key={key}
            ref={selected === key ? selectedRowRef : undefined}
            active={selected === key}
            // The dot is aria-hidden, so the state is part of the row's name.
            aria-label={t("mcp.rowLabel", { name, state: t(mcpRowStateLabelKey(state, server.status)) })}
            onClick={() => onSelect(key)}
          >
            <ConfigStatusDot {...mcpStatusDot(tone)} />
            <ConfigSidebarText className={`is-grow${tone === "on" ? "" : " is-muted"}`}>{name}</ConfigSidebarText>
            {badgeKey && <span className={`mcp-sidebar-badge is-${tone}`}>{t(badgeKey)}</span>}
          </ConfigSidebarItem>
        );
      })}
    </div>
  );
}

function McpFieldChips({ fields }: { fields: readonly McpConfigFieldRef[] }) {
  const { t } = useI18n();
  return (
    <span className="mcp-config-chips">
      {fields.map((field) => {
        const label = mcpFieldLabel(field);
        return (
          <code key={`${field.kind}\0${field.name ?? ""}`} className="mcp-config-chip">
            {t(label.key, label.params)}
          </code>
        );
      })}
    </span>
  );
}

/** Env or header names: the values stay in the file and never reach the browser. */
function McpNameList({ names }: { names: readonly string[] }) {
  const { t } = useI18n();
  return (
    <span className="mcp-config-lines">
      <span className="mcp-config-chips">
        {names.map((name) => <code key={name} className="mcp-config-chip">{revealHiddenCharacters(name)}</code>)}
      </span>
      <span className="mcp-config-line is-dim">{t("mcp.detail.valuesHidden")}</span>
    </span>
  );
}

/** The sentence under a server's state: why it does or does not connect. */
function McpStateDetail({ server, state }: { server: McpServerInfo; state: ReturnType<typeof mcpServerRowState> }) {
  const { t } = useI18n();
  if (state === "invalid") {
    return (
      <span className="mcp-config-line is-warning">
        {t("mcp.server.invalid")} <code className="mcp-config-chip">{revealHiddenCharacters(server.invalidError ?? "")}</code>
      </span>
    );
  }
  // None for web-password: the PI_WEB_PASSWORD line, which every state shows, says it.
  const key = mcpRowStateDetailKey(state);
  return key ? <span className="mcp-config-line">{t(key)}</span> : null;
}

function McpServerDetail({
  server,
  context,
  codemode,
  autoEnable,
  block,
  savedWhileOff,
  busy,
  controlsBusy,
  actionError,
  test,
  testBlock,
  signIn,
  signInBlock,
  signOutBlock,
  onSwitch,
  onRemove,
  onTest,
  onSignIn,
  onSignOut,
  onSignInPaste,
  onSignInCancel,
}: {
  server: McpServerInfo;
  context: McpRowContext;
  codemode: McpCodemodeInfo;
  autoEnable: McpAutoEnableCodemode;
  /** Why this server cannot be changed here. */
  block: McpWriteBlock | undefined;
  /** MCP is off by `-builtin:mcp`: changes are written, but no session connects these servers. */
  savedWhileOff: boolean;
  busy: string | null;
  controlsBusy: boolean;
  /** The last change to this server that failed. */
  actionError: McpActionFailure | null;
  /** This server's test, if the panel started one. */
  test: McpTestRun | undefined;
  /** Why it cannot be tested. */
  testBlock: McpTestBlock | undefined;
  /** This server's sign-in, if the panel started or joined one. */
  signIn: McpSignInRun | undefined;
  /** Why it cannot be signed in to, or out of. */
  signInBlock: McpTestBlock | undefined;
  signOutBlock: McpTestBlock | undefined;
  onSwitch: (server: McpServerInfo, enabled: boolean) => void;
  onRemove: (server: McpServerInfo) => void;
  onTest: (server: McpServerInfo) => void;
  onSignIn: (server: McpServerInfo) => void;
  onSignOut: (server: McpServerInfo) => void;
  onSignInPaste: (server: McpServerInfo, flowId: string, value: string) => void;
  onSignInCancel: (server: McpServerInfo, flowId: string) => void;
}) {
  const { t } = useI18n();
  const noteId = useId();
  const testBlockId = useId();
  const state = mcpServerRowState(server, context);
  const tone = mcpRowStateTone(state);
  const target = mcpServerTarget(server);
  // A refused entry never connects, so nothing in it runs or is sent.
  const connects = server.invalidError === undefined;
  const http = server.transport === "http" || (server.transport === undefined && server.url !== undefined);
  const stdio = !http && (server.transport === "stdio" || server.command !== undefined);
  const viaCodemode = server.exposure === "codemode" || server.exposure === "codemode-deferred";
  const reachNotice = viaCodemode ? mcpCodemodeReachNotice(codemode, autoEnable) : undefined;
  const key = mcpServerKey(server);
  const name = revealHiddenCharacters(server.name);
  // The route never turns on an entry that references PI_WEB_PASSWORD; turning one off still works.
  const passwordKeepsOff = !server.enabled && server.webPasswordField !== undefined;
  // An entry that is not an object has no `enabled` to write; Remove still works.
  const switchless = server.notAnObject === true;
  // The note under the controls: why they cannot be used, or, under -builtin:mcp, that a change is
  // written but no session connects its servers. Nothing when they simply work.
  const note = block
    ? t(`mcp.reason.${block}`)
    : switchless
      ? t("mcp.reason.entry-not-object")
      : passwordKeepsOff
        ? t("mcp.reason.web-password")
        : savedWhileOff
          ? t("mcp.write.savedWhileOff")
          : undefined;

  return (
    <ConfigDetailStack>
      <div className="config-detail-heading">
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <ConfigScopeTag scope={server.scope}>{scopeLabel(server.scope, t)}</ConfigScopeTag>
            <ConfigDetailTitle>{name}</ConfigDetailTitle>
          </ConfigDetailHeaderInfo>
          <ConfigDetailActions>
            <McpTestButton server={server} test={test} testBlock={testBlock} describedBy={testBlockId} onTest={onTest} />
            <ConfigButton
              variant="danger"
              size="small"
              disabled={controlsBusy || block !== undefined}
              aria-describedby={block ? noteId : undefined}
              onClick={() => onRemove(server)}
            >
              {busy === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
            </ConfigButton>
            <ConfigSwitch
              checked={server.enabled}
              disabled={controlsBusy || block !== undefined || switchless || passwordKeepsOff}
              loading={busy === `switch:${key}`}
              describedBy={note ? noteId : undefined}
              label={t(server.enabled ? "mcp.server.switchOff" : "mcp.server.switchOn", { name })}
              onChange={(enabled) => onSwitch(server, enabled)}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        {note && <div id={noteId} className="config-detail-heading-note">{note}</div>}
      </div>
      {actionError && (
        <p role="alert" className="mcp-config-line is-error">
          {t("mcp.actionFailed")} {actionFailureText(actionError, t)}
        </p>
      )}

      <ConfigDetailGrid>
        <ConfigDetailGridRow label={t("i18n.status")} tone="plain">
          <span className="mcp-config-lines">
            <span className={`mcp-config-state is-${tone}`}>{t(mcpRowStateLabelKey(state, server.status))}</span>
            <McpStateDetail server={server} state={state} />
            {server.webPasswordField && (
              <span className="mcp-config-line is-warning">
                {t("mcp.server.webPassword")} <McpFieldChips fields={[server.webPasswordField]} />
              </span>
            )}
          </span>
        </ConfigDetailGridRow>
        <McpConnectionRows server={server} test={test} testBlock={testBlock} testBlockId={testBlockId} />
        {server.transport && (
          <ConfigDetailGridRow label={t("mcp.detail.transport")}>
            {t(`mcp.transport.${server.transport}`)}
          </ConfigDetailGridRow>
        )}
        {target !== undefined && (
          <ConfigDetailGridRow label={http ? t("mcp.detail.url") : t("mcp.detail.command")} tone="plain" mono>
            {target}
          </ConfigDetailGridRow>
        )}
        {/* Left out when not set: the server then runs in the session's folder, with no env or headers of its own. */}
        {stdio && server.cwd !== undefined && (
          <ConfigDetailGridRow label={t("mcp.detail.cwd")} mono>{revealHiddenCharacters(server.cwd)}</ConfigDetailGridRow>
        )}
        {stdio && server.envNames.length > 0 && (
          <ConfigDetailGridRow label={t("mcp.detail.env")}>
            <McpNameList names={server.envNames} />
          </ConfigDetailGridRow>
        )}
        {http && server.headerNames.length > 0 && (
          <ConfigDetailGridRow label={t("mcp.detail.headers")}>
            <McpNameList names={server.headerNames} />
          </ConfigDetailGridRow>
        )}
        {connects && server.commandFields.length > 0 && (
          <ConfigDetailGridRow label={t("mcp.detail.shellCommands")} tone="plain">
            <span className="mcp-config-lines">
              <span className="mcp-config-line is-warning">{t("mcp.server.commandFields")}</span>
              <McpFieldChips fields={server.commandFields} />
            </span>
          </ConfigDetailGridRow>
        )}
        {connects && server.variableReferences.length > 0 && (
          <ConfigDetailGridRow label={t("mcp.detail.variables")} tone="plain">
            <span className="mcp-config-lines">
              <span className="mcp-config-line is-warning">{t(mcpVariableReferencesKey(server))}</span>
              <span className="mcp-config-chips">
                {mcpVariableChips(server.variableReferences).map(({ variable, field }) => {
                  const label = mcpFieldLabel(field);
                  return (
                    <code key={`${variable}\0${field.kind}\0${field.name ?? ""}`} className="mcp-config-chip">
                      {t("mcp.server.variableIn", { variable, field: t(label.key, label.params) })}
                    </code>
                  );
                })}
              </span>
            </span>
          </ConfigDetailGridRow>
        )}
        {http && connects && (
          <McpSignInRow
            server={server}
            run={signIn}
            block={signInBlock}
            signOutBlock={signOutBlock}
            controlsBusy={controlsBusy}
            signingOut={busy === `sign-out:${key}`}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onPaste={onSignInPaste}
            onCancel={onSignInCancel}
          />
        )}
        {server.exposure && (
          <ConfigDetailGridRow label={t("mcp.detail.exposure")} tone="plain">
            <span className="mcp-config-lines">
              <span className="mcp-config-line">{t(MCP_EXPOSURE_KEYS[server.exposure])}</span>
              {reachNotice && <span className="mcp-config-line is-warning">{noticeText(reachNotice, t)}</span>}
            </span>
          </ConfigDetailGridRow>
        )}
        <ConfigDetailGridRow label={t("mcp.detail.file")} tone="dim" mono>
          {displayPath(server.sourcePath)}
        </ConfigDetailGridRow>
      </ConfigDetailGrid>

      <div className="mcp-config-lines">
        {mcpServerHasHiddenCharacters(server) && (
          <p className="mcp-config-line is-warning">{t("mcp.server.hiddenCharacters")}</p>
        )}
        {!server.validated && <p className="mcp-config-line is-warning">{t("mcp.server.unchecked")}</p>}
        {server.replacesGlobal && <p className="mcp-config-line is-warning">{t("mcp.server.replacesGlobal")}</p>}
        {server.shadowedByProject && state !== "replaced" && (
          <p className="mcp-config-line">{t("mcp.server.shadowedByProject")}</p>
        )}
        {server.masked && <p className="mcp-config-line is-dim">{t("mcp.server.masked")}</p>}
      </div>
    </ConfigDetailStack>
  );
}

/** A server's stderr as lines, each with its hidden characters escaped; the line breaks stay. */
function revealLines(text: string): string {
  return text.split(/\r?\n/).map(revealHiddenCharacters).join("\n");
}

/** Why a test request did not answer with a result, in a test's words where the reason has them. */
function testFailureText(failure: McpActionFailure, t: Translate): string {
  if (failure.timedOut) return t("mcp.test.requestTimedOut");
  const key = failure.reason ? MCP_TEST_REFUSAL_KEYS[failure.reason] : undefined;
  return key ? t(key) : failureText(failure, t);
}

/** A status's error and the stderr tail it kept, as the server's text with its hidden characters escaped. */
function McpStatusOutput({ error, stderr }: { error?: string; stderr?: string }) {
  const { t } = useI18n();
  return (
    <>
      {error && (
        <span className="mcp-config-line is-error">
          {t("mcp.test.error")} <code className="mcp-config-chip">{revealHiddenCharacters(error)}</code>
        </span>
      )}
      {stderr && (
        <>
          <span className="mcp-config-line is-dim">{t("mcp.test.stderr")}</span>
          <pre className="mcp-test-output">{revealLines(stderr)}</pre>
        </>
      )}
    </>
  );
}

/** The last known status: a test's or an open session's. */
function McpStatusLines({ status }: { status: McpServerStatus }) {
  return status.origin === "session" ? <McpSessionStatusLines status={status} /> : <McpTestStatusLines status={status} />;
}

/** What the last test found: its state with when and how long, the error and stderr, and what the server said about itself. */
function McpTestStatusLines({ status }: { status: McpServerStatus & { origin: "test" } }) {
  const { t, locale } = useI18n();
  const view = mcpTestStateView(status);
  const time = mcpStatusTimeText(status.testedAt, locale);
  const info = status.serverInfo;
  return (
    <>
      <span className="mcp-config-line">
        <span className={`mcp-config-state is-${view.tone}`}>{t(view.key)}</span>{" "}
        {t(mcpTestSummaryKey(status), { count: status.toolCount, seconds: mcpSeconds(status.durationMs), time })}
      </span>
      <McpStatusOutput error={status.error} stderr={status.stderr} />
      {info && (
        <span className="mcp-config-line is-dim">
          {t("mcp.test.serverInfo", { name: revealHiddenCharacters(info.title ?? info.name), version: revealHiddenCharacters(info.version) })}
        </span>
      )}
      {status.resources !== undefined && (
        <span className="mcp-config-line is-dim">
          {t("mcp.test.resources", { resources: status.resources, templates: status.resourceTemplates ?? 0 })}
        </span>
      )}
      {status.cwd !== undefined && <span className="mcp-config-line is-dim">{t("mcp.test.ranIn", { path: displayPath(status.cwd) })}</span>}
      {status.queuedMs !== undefined && status.queuedMs >= 500 && (
        <span className="mcp-config-line is-dim">{t("mcp.test.queued", { seconds: mcpSeconds(status.queuedMs) })}</span>
      )}
    </>
  );
}

/**
 * What an open session last saw: its state, the folder of the session that
 * reported it (a global stdio server runs in each session's own), when, and
 * why where it says: the error and stderr, or the extension that holds the
 * name. A connection the session has closed since says when it closed.
 */
function McpSessionStatusLines({ status }: { status: McpSessionStatus }) {
  const { t, locale } = useI18n();
  const view = mcpSessionStateView(status);
  const time = mcpStatusTimeText(status.updatedAt, locale);
  const closedTime = status.closedAt === undefined ? undefined : mcpStatusTimeText(status.closedAt, locale);
  return (
    <>
      <span className="mcp-config-line">
        <span className={`mcp-config-state is-${view.tone}`}>{t(view.key)}</span>{" "}
        {t(mcpSessionSummaryKey(status), { path: displayPath(status.cwd), time, ...(closedTime === undefined ? {} : { closedTime }) })}
      </span>
      {status.conflict !== undefined && (
        <span className="mcp-config-line is-error">
          {t("mcp.session.conflictOwner")} <code className="mcp-config-chip">{displayPath(status.conflict)}</code>
        </span>
      )}
      <McpStatusOutput error={status.error} stderr={status.stderr} />
    </>
  );
}

/** The tools a connected test listed, read-only: name, whether the server marks it read-only, an exposure of its own, and its description's first line. */
function McpTestToolList({ status, serverExposure }: { status: McpServerStatus & { origin: "test" }; serverExposure: McpServerInfo["exposure"] }) {
  const { t } = useI18n();
  const notShown = status.toolCount - status.tools.length;
  return (
    <span className="mcp-config-lines">
      <ul className="mcp-test-tools">
        {status.tools.map((tool, index) => (
          <li key={`${index}\0${tool.name}`} className="mcp-test-tool">
            <span className="mcp-config-chips">
              <code className="mcp-config-chip">{revealHiddenCharacters(tool.name)}</code>
              {tool.readOnly && <span className="mcp-test-tool-tag">{t("mcp.test.readOnly")}</span>}
              {tool.exposure !== (serverExposure ?? "codemode") && (
                <span className="mcp-test-tool-tag">{t(MCP_EXPOSURE_SHORT_KEYS[tool.exposure])}</span>
              )}
            </span>
            {tool.description && <span className="mcp-config-line is-dim">{revealHiddenCharacters(tool.description)}</span>}
          </li>
        ))}
      </ul>
      {notShown > 0 && <span className="mcp-config-line is-dim">{t("mcp.test.moreTools", { count: notShown })}</span>}
    </span>
  );
}

/**
 * The Connection row: the server's last known status (from a Test or an
 * open session) and what it found, the Test button, and why it cannot be
 * used, which the button points at; then, when a test connected, the tools it
 * listed.
 */
/**
 * Test, in the detail header: one connection through `POST /api/mcp/test`. It
 * writes no file, so a change on its way does not hold it; disabled while its
 * test runs, or where the route would refuse it, pointing at that reason in
 * the Connection row.
 */
function McpTestButton({
  server,
  test,
  testBlock,
  describedBy,
  onTest,
}: {
  server: McpServerInfo;
  test: McpTestRun | undefined;
  testBlock: McpTestBlock | undefined;
  /** The id of the Connection row's line that says why Test cannot be used. */
  describedBy: string;
  onTest: (server: McpServerInfo) => void;
}) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const running = test?.running === true;
  // The button is disabled while its test runs, which drops focus to the page
  // behind Settings; it gets it back once the answer is in, only from there.
  const wasRunningRef = useRef(running);
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (wasRunning && !running) focusIfLost(document, buttonRef.current);
  }, [running]);
  return (
    <ConfigButton
      ref={buttonRef}
      size="small"
      disabled={running || testBlock !== undefined}
      aria-busy={running || undefined}
      aria-describedby={testBlock ? describedBy : undefined}
      onClick={() => onTest(server)}
    >
      {running ? t("mcp.test.testing") : t("mcp.test.button")}
    </ConfigButton>
  );
}

/** The Connection row: the last status, why Test cannot be used, and what the last test request did; then the tools a test listed. */
function McpConnectionRows({
  server,
  test,
  testBlock,
  testBlockId,
}: {
  server: McpServerInfo;
  test: McpTestRun | undefined;
  testBlock: McpTestBlock | undefined;
  testBlockId: string;
}) {
  const { t } = useI18n();
  const status = server.status;
  return (
    <>
      <ConfigDetailGridRow label={t("mcp.detail.connection")} tone="plain">
        <span className="mcp-config-lines">
          {status ? <McpStatusLines status={status} /> : <span className="mcp-config-line">{t("mcp.test.never")}</span>}
          {test?.queueTimedOut && <span role="alert" className="mcp-config-line is-error">{t("mcp.test.queueTimedOut")}</span>}
          {test?.error && (
            <span role="alert" className="mcp-config-line is-error">
              {t("mcp.test.requestFailed")} {testFailureText(test.error, t)}
            </span>
          )}
          {testBlock && <span id={testBlockId} className="mcp-config-line is-dim">{t(MCP_TEST_BLOCK_KEYS[testBlock])}</span>}
          {/* Its own line, so no locale has to join two sentences with a space. */}
          {!testBlock && server.commandFields.length > 0 && <span className="mcp-config-line is-dim">{t(MCP_TEST_SERIAL_KEY)}</span>}
        </span>
      </ConfigDetailGridRow>
      {status?.origin === "test" && status.state === "connected" && status.toolCount > 0 && (
        <ConfigDetailGridRow label={t("mcp.detail.listedTools")} tone="plain">
          <McpTestToolList status={status} serverExposure={server.exposure} />
        </ConfigDetailGridRow>
      )}
    </>
  );
}

/**
 * Code mode: the one choice, Automatic or Always on, saved to the global
 * `defaultTools` and read by sessions started afterwards (pi applies
 * `defaultTools` when it creates a session, so nothing reloads); a trusted
 * project whose own `defaultTools` decides it there; whether its sandbox can
 * run; and whether a setting turns it off. Always on is disabled, with the
 * reason as text under the switch, while no session could offer Code mode.
 */
function McpCodemodeDetail({
  codemode,
  autoEnable,
  save,
  serverBusy,
  onChange,
}: {
  codemode: McpCodemodeInfo;
  autoEnable: McpAutoEnableCodemode;
  save: McpCodemodeSaveState;
  /** A server change is on its way; its answer carries the Code mode choice as read before this save. */
  serverBusy: boolean;
  onChange: (preference: McpCodemodePreference) => void;
}) {
  const { t } = useI18n();
  const sandbox = codemode.sandbox;
  const preference = codemode.preference;
  const waiting = save.saving || serverBusy;
  const automaticNotice = mcpCodemodeAutomaticNotice(codemode, autoEnable);
  const alwaysUnavailable = mcpCodemodeAlwaysUnavailableNotice(codemode);
  const builtinNotice = mcpCodemodeBuiltinNotice(codemode);
  const projectOverride = mcpCodemodeProjectOverrideNotice(codemode);
  return (
    <ConfigDetailStack>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigDetailTitle>{t("mcp.codemode.title")}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
      </ConfigDetailHeader>
      <p className="mcp-config-line">{t("mcp.codemode.intro")}</p>

      <ConfigDetailGrid>
        <ConfigDetailGridRow label={t("mcp.codemode.mode")} tone="plain">
          <div className="mcp-config-lines">
            {preference ? (
              <>
                <ConfigScopeSwitch
                  value={preference}
                  label={t("mcp.codemode.title")}
                  options={[
                    { value: "automatic", label: t(MCP_CODEMODE_STATE_KEYS.automatic), disabled: waiting },
                    {
                      value: "always",
                      label: t(MCP_CODEMODE_STATE_KEYS.always),
                      disabled: waiting || alwaysUnavailable !== undefined,
                    },
                  ]}
                  disabledReason={alwaysUnavailable ? noticeText(alwaysUnavailable, t) : null}
                  onChange={(value) => {
                    if (value !== preference) onChange(value);
                  }}
                >
                  {save.saving && <span role="status" className="mcp-config-line is-dim">{t("i18n.saving")}</span>}
                </ConfigScopeSwitch>
                <span className="mcp-config-line">
                  {t(preference === "always" ? "mcp.codemode.alwaysDescription" : "mcp.codemode.automaticDescription")}
                </span>
                <span className="mcp-config-line is-dim">{t("mcp.codemode.appliesLater")}</span>
              </>
            ) : (
              <span className="mcp-config-line is-warning">
                {t("mcp.codemode.preferenceError")}{" "}
                <code className="mcp-config-chip">{revealHiddenCharacters(codemode.preferenceError ?? "")}</code>
              </span>
            )}
            {/* Shown on every platform: unlike the PowerShell switch, Code mode is not Windows-only. */}
            {save.error && (
              <span role="alert" className="mcp-config-line is-error">
                {t("mcp.codemode.saveFailed")}{" "}
                {save.error.timedOut
                  ? t("mcp.codemode.saveTimedOut")
                  : save.error.reason && save.error.reason !== "internal"
                    ? t(`mcp.reason.${save.error.reason}`)
                    : <code className="mcp-config-chip">{revealHiddenCharacters(save.error.error)}</code>}
              </span>
            )}
            {projectOverride && <span className="mcp-config-line is-warning">{noticeText(projectOverride, t)}</span>}
            {automaticNotice && <span className="mcp-config-line is-warning">{noticeText(automaticNotice, t)}</span>}
          </div>
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("mcp.codemode.sandbox")} tone="plain">
          {sandbox.state === "unavailable" ? (
            <span className="mcp-config-line is-warning">
              {t("mcp.codemode.sandbox.unavailable")}{" "}
              <code className="mcp-config-chip">{revealHiddenCharacters(sandbox.error)}</code>
            </span>
          ) : (
            <span className="mcp-config-line">
              {t(sandbox.state === "available" ? "mcp.codemode.sandbox.available" : "mcp.codemode.sandbox.not-checked")}
            </span>
          )}
        </ConfigDetailGridRow>
        {builtinNotice && (
          <ConfigDetailGridRow label={t("mcp.codemode.builtin")} tone="error">
            {noticeText(builtinNotice, t)}
          </ConfigDetailGridRow>
        )}
      </ConfigDetailGrid>
    </ConfigDetailStack>
  );
}
