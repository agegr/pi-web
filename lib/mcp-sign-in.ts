import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpRefusalReason, McpSignInFailure, McpSignInFlowInfo, McpSignInPhase, McpTestResult } from "./api-types";
import {
  guardedCredentialStore,
  mcpOAuthUrl,
  McpSignedOutError,
  mcpSignInKey,
  mcpSignOutCount,
  noteMcpSignOut,
  type McpSignInWriteGuard,
} from "./mcp-sign-out";
import { recordMcpStatus } from "./mcp-status";
import {
  closeTestConnection,
  createTestRedactor,
  maskStatusError,
  MCP_TEST_DEADLINE_MS,
  observeTestConnection,
  openTestConnection,
  runsShellCommand,
  takeMcpCommandSlot,
  type McpTestInternals,
  type McpTestRun,
  type McpTestTarget,
} from "./mcp-test";
import type {
  McpOAuthChallenge,
  McpOAuthSettings,
  McpOAuthStateStore,
  McpSignInOptions,
  PiSdkInternals,
} from "./pi-sdk-internals";

// The URL rule, the sign-out counts and the guarded store live in
// `lib/mcp-sign-out.ts`, which Tests use too; re-exported for the routes.
export { guardedCredentialStore, mcpOAuthUrl, McpSignedOutError, mcpSignInKey, type McpSignInWriteGuard };

// Settings › MCP's sign-in (ADR 0006), run as `pi mcp login` runs it (SDK
// `extensions/mcp/cli.js` login()): connect once, to learn whether the server
// asks for a sign-in and to record its OAuth challenge; then the SDK's
// `signInMcpServer()` with `connection.oauthSettings()`, the challenge, and a
// prompt — `showAuthorizationUrl` moves the flow to `authorize`, and
// `promptForRedirectUrl` waits for a pasted address or the loopback callback;
// then reconnect with the new tokens, list what the server offers, and record
// that as the entry's status (`lib/mcp-status.ts`), as a Test would.
//
// What the SDK leaves to its caller, and this file does:
// - **The flow outlives every request.** It lives in a globalThis registry
//   (`Symbol.for("pi-web:mcp-sign-in")`) under a random id; the browser polls
//   it (`GET /api/mcp/sign-in/[flowId]`), and nothing ties it to a request
//   signal or an event stream, so a phone that sleeps or a closed tab does not
//   end it.
// - **One flow per server per process.** The SDK keeps one PKCE verifier and
//   one `state` per server (its name and URL, `mcpSignInKey()`) in
//   `mcp-auth.json`, so two sign-ins of one server overwrite each other's and
//   both fail. A second start joins the flow under way; a new flow of a server
//   whose previous run is still unwinding (cancelled or expired, its network
//   request not answered yet) waits for that run.
// - **A time limit.** The SDK's loopback callback gives up after 5 minutes and
//   `signInMcpServer()` takes no AbortSignal: the flow expires at the same
//   5 minutes (counted from its start, so it ends first), and the only way to
//   stop the SDK is to answer its prompt with "" (McpSignInCancelledError).
//   A cancel that arrives before the prompt is asked is kept and applied the
//   moment it is; before the sign-in started at all, it never starts. A flow
//   that already has its code when the limit comes gets one grace period to
//   finish, since the SDK exchanges the code whatever Pi Web does.
// - **A pasted address is checked first.** The SDK ends the whole sign-in on
//   a paste that is not a URL, carries another sign-in's `state`, or has no
//   `code`. `pasteMcpSignInRedirect()` refuses those (and an `error` answer)
//   and leaves the flow waiting, comparing `state` with the one the SDK
//   stored (watched through the store it is given), which is the one it
//   checks against.
// - **No browser at all** is a normal ending: a stored refresh token renews
//   the tokens inside `signInMcpServer()`, which then never shows a page.
// - **Signing out stops every write a run still has on its way.** A cancel
//   only answers a prompt that still waits: a code exchange, or a refresh
//   (the SDK's own, or the connection's), already on its way stores its
//   tokens whatever happens to the flow, which would sign the URL back in
//   right after `signOutMcpServer()` removed them. So a run writes
//   `mcp-auth.json` only through stores that first check the server's
//   sign-out count (`McpSignInWriteGuard`), and throw once it moved since the
//   run started; the check and the SDK's write happen in one synchronous step.
// - Starting a sign-in may replace the stored client registration and tokens
//   (the SDK drops a registration whose redirect URI is not the new one), so
//   the panel says so beside the button.

/** How long a flow waits: the SDK's loopback callback gives up after 5 minutes too (pi-mcp `OAuthCallbackServer`). */
export const MCP_SIGN_IN_TTL_MS = 5 * 60_000;
/** How long an ended flow stays readable, so the browser's next poll sees how it ended. */
export const MCP_SIGN_IN_KEEP_MS = 60_000;
/**
 * How much longer a flow that has its code when the limit comes gets to
 * finish: the SDK exchanges it whatever Pi Web does, so expiring then would
 * call a sign-in that is about to work "expired". Once, then it expires.
 */
export const MCP_SIGN_IN_FINISH_GRACE_MS = 60_000;
/** Flows held at once; ended ones go first, oldest first. */
export const MCP_SIGN_IN_MAX_FLOWS = 100;
/** The longest redirected address a paste may be. */
export const MCP_SIGN_IN_MAX_PASTE_CHARS = 16 * 1024;

const ENDED: ReadonlySet<McpSignInPhase> = new Set<McpSignInPhase>(["done", "failed", "cancelled", "expired"]);
const DENIAL_MAX_CHARS = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// What a flow needs from the SDK, replaceable in tests
// ---------------------------------------------------------------------------

/** The entry to sign in to, as the route read and checked it. */
export interface McpSignInTarget extends McpTestTarget {
  /** `mcpOAuthUrl()` of the entry: what the tokens are stored under. */
  url: string;
  /**
   * Asked again right before connecting with the new tokens, minutes after the
   * route's checks: whether the entry may still be connected (a project
   * entry's trust). When it says no, the flow ends signed in, without that
   * connection.
   */
  mayConnect?: () => boolean;
}

/** The one connection a flow keeps, from its first connect to its reconnect with the new tokens. */
export interface McpSignInConnection {
  /** Connects once; `signal` stops it. A connect has its own deadline, as a test does. */
  connect(signal: AbortSignal): Promise<McpTestRun>;
  /** After a connect that read `needs-auth`: the server's `WWW-Authenticate` challenge. */
  readonly challenge: McpOAuthChallenge | undefined;
  /** `connection.oauthSettings()`: resolves `oauth.clientSecret`, which may run a `!command`, and may throw. */
  oauthSettings(): McpOAuthSettings;
  /** Clears the challenge and connects again with what `mcp-auth.json` holds now. */
  reconnect(signal: AbortSignal): Promise<McpTestRun>;
  /** Masks a message as a test's messages are masked. */
  redact(text: string): string;
  /** Closes everything; never waits long. */
  close(): Promise<void>;
}

export interface McpSignInDeps {
  /** The connection's store must call `guard` before each write (`guardedCredentialStore()`). */
  open(target: McpSignInTarget, guard: McpSignInWriteGuard): McpSignInConnection;
  /** The SDK's `signInMcpServer()`. */
  signIn(options: McpSignInOptions): Promise<void>;
  /** The server's part of `mcp-auth.json`, from the SDK's credential store, by its name and URL. */
  store(name: string, url: string): McpOAuthStateStore;
  /** Whether `error` is the SDK's McpSignInCancelledError: the prompt was answered with "". */
  isCancelled(error: unknown): boolean;
}

export type McpSignInInternals = McpTestInternals & Pick<PiSdkInternals, "signInMcpServer" | "McpSignInCancelledError">;

/**
 * The connection a test opens (`openTestConnection()`), kept open across the
 * sign-in. Each connect takes a place in the queue of tests that run a shell
 * command when the entry holds one, and gets the test's deadline once it has
 * its turn; `oauth.clientSecret`, which may be a `!command` too, is resolved
 * while that place is held. Its resolved value is masked like the others.
 * With a `guard`, the connection reads and refreshes tokens through
 * `guardedCredentialStore()`.
 */
export function openMcpSignInConnection(
  target: McpSignInTarget,
  internals: McpTestInternals,
  options: { deadlineMs?: number; guard?: McpSignInWriteGuard } = {},
): McpSignInConnection {
  const deadlineMs = options.deadlineMs ?? MCP_TEST_DEADLINE_MS;
  const opened = openTestConnection(target, internals, options.guard ? { credentials: guardedCredentialStore(internals, options.guard) } : {});
  const resolvedSecrets: string[] = [];
  let settings: { value: McpOAuthSettings } | { error: unknown } | undefined;
  const serial = runsShellCommand(target.config, internals);
  const readSettings = () => {
    try {
      const value = opened.connection.oauthSettings();
      if (value.clientSecret) resolvedSecrets.push(value.clientSecret);
      settings = { value };
    } catch (error) {
      settings = { error };
    }
  };
  const turn = async (stop: AbortSignal, run: (signal: AbortSignal) => Promise<McpTestRun>): Promise<McpTestRun> => {
    const slot = serial ? await takeMcpCommandSlot(stop, deadlineMs) : undefined;
    if (slot && !slot.turn) {
      return { state: "failed", tools: [], toolCount: 0, durationMs: 0, ...(slot.timedOut ? { queueTimedOut: true } : { timedOut: true }) };
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, deadlineMs);
    timer.unref?.();
    if (stop.aborted) abort();
    else stop.addEventListener("abort", abort, { once: true });
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
      stop.removeEventListener("abort", abort);
      slot?.release();
    }
  };
  return {
    connect: (stop) => turn(stop, async (signal) => {
      const run = await observeTestConnection(opened, target, internals, signal);
      if (run.state === "needs-auth") readSettings();
      return run;
    }),
    get challenge() {
      return opened.connection.challenge;
    },
    oauthSettings() {
      if (!settings) readSettings();
      if (!settings || "error" in settings) throw settings ? settings.error : new Error("OAuth settings were not read");
      return settings.value;
    },
    reconnect: (stop) => turn(stop, (signal) => {
      opened.connection.challenge = undefined;
      return observeTestConnection(opened, target, internals, signal, {
        attempt: async () => {
          await opened.connection.reconnect();
          return opened.connection.getClient();
        },
        resolvedSecrets,
      });
    }),
    redact: (text) => createTestRedactor(target.config, opened.transports, internals, resolvedSecrets)(text),
    close: () => closeTestConnection(opened),
  };
}

/** The SDK's own pieces: its connection (through Pi Web's transport factory), sign-in and credential store. */
export function createMcpSignInDeps(internals: McpSignInInternals): McpSignInDeps {
  return {
    open: (target, guard) => openMcpSignInConnection(target, internals, { guard }),
    signIn: (options) => internals.signInMcpServer(options),
    store: (name, url) => new internals.McpOAuthCredentialStore().forServer(name, url),
    isCancelled: (error) => error instanceof internals.McpSignInCancelledError || (error instanceof Error && error.name === "McpSignInCancelledError"),
  };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

interface Flow {
  id: string;
  /** `mcpSignInKey()` of the target's name and URL. */
  key: string;
  target: McpSignInTarget;
  /** The server's sign-out count when the flow started; its run writes nothing once that moved. */
  signOutsAtStart: number;
  phase: McpSignInPhase;
  expiresAt: number;
  keepMs: number;
  /** How long a flow that has its code when the limit comes gets to finish. */
  graceMs: number;
  /** The limit came while the code was being exchanged, and the flow got `graceMs` more. */
  graced?: true;
  /** Aborted when the flow ends: stops a connect, and a wait for the queue. */
  controller: AbortController;
  expiry?: NodeJS.Timeout;
  authorizationUrl?: string;
  redirectUrl?: string;
  /** The `state` the SDK stored last, read through the store it was given. */
  storedState?: string;
  /** The `state` a pasted address must carry: the stored one when the page was shown. */
  expectedState?: string;
  /** Answers the SDK's prompt, while it waits. */
  prompt?: (value: string | undefined) => void;
  sawPage: boolean;
  alreadySignedIn?: true;
  refreshed?: true;
  result?: McpTestResult;
  failure?: McpSignInFailure;
  error?: string;
}

interface Registry {
  flows: Map<string, Flow>;
  /** Sign-in key → the flow under way for it. */
  active: Map<string, string>;
  /** Sign-in key → the end of the last run started for it, which the next run waits for. */
  tails: Map<string, Promise<void>>;
}

const REGISTRY_KEY: symbol = Symbol.for("pi-web:mcp-sign-in");

function registry(): Registry {
  const store = globalThis as Record<symbol, Registry | undefined>;
  return (store[REGISTRY_KEY] ??= { flows: new Map(), active: new Map(), tails: new Map() });
}

/** The guard of a flow's run: its server must not have been signed out since the flow started. */
function writeGuard(flow: Flow): McpSignInWriteGuard {
  return () => {
    if (mcpSignOutCount(flow.key) !== flow.signOutsAtStart) throw new McpSignedOutError();
  };
}

function isEnded(flow: Flow): boolean {
  return ENDED.has(flow.phase);
}

/** Moves a flow that has not ended on; an ended one stays as it ended. */
function setPhase(flow: Flow, phase: McpSignInPhase): void {
  if (!isEnded(flow)) flow.phase = phase;
}

/**
 * Ends a flow once: stops what it waits on, answers a waiting prompt with ""
 * (which ends the SDK's sign-in), frees its URL for a new flow, and forgets
 * it `keepMs` later. Its run goes on unwinding in the background and changes
 * nothing about it any more.
 */
function end(flow: Flow, phase: McpSignInPhase, extra: Partial<Pick<Flow, "alreadySignedIn" | "refreshed" | "result" | "failure" | "error">> = {}): void {
  if (isEnded(flow)) return;
  Object.assign(flow, extra);
  flow.phase = phase;
  clearTimeout(flow.expiry);
  flow.controller.abort();
  const prompt = flow.prompt;
  flow.prompt = undefined;
  prompt?.("");
  const { flows, active } = registry();
  if (active.get(flow.key) === flow.id) active.delete(flow.key);
  const forget = setTimeout(() => {
    if (flows.get(flow.id) === flow) flows.delete(flow.id);
  }, flow.keepMs);
  forget.unref?.();
}

function describeFlow(flow: Flow): McpSignInFlowInfo {
  const ended = isEnded(flow);
  return {
    flowId: flow.id,
    scope: flow.target.scope,
    name: flow.target.name,
    configKey: flow.target.configKey,
    phase: flow.phase,
    expiresInMs: ended ? 0 : Math.max(0, flow.expiresAt - Date.now()),
    ...(flow.phase === "authorize" && flow.authorizationUrl !== undefined
      ? { authorizationUrl: flow.authorizationUrl, ...(flow.redirectUrl !== undefined ? { redirectUrl: flow.redirectUrl } : {}) }
      : {}),
    ...(flow.alreadySignedIn ? { alreadySignedIn: true as const } : {}),
    ...(flow.refreshed ? { refreshed: true as const } : {}),
    ...(flow.result ? { result: flow.result } : {}),
    ...(flow.failure ? { failure: flow.failure } : {}),
    ...(flow.error !== undefined ? { error: flow.error } : {}),
  };
}

/** Drops ended flows, oldest first, while more than the cap are held. A flow under way is never dropped. */
function prune(flows: Map<string, Flow>): void {
  for (const [id, flow] of flows) {
    if (flows.size <= MCP_SIGN_IN_MAX_FLOWS) return;
    if (isEnded(flow)) flows.delete(id);
  }
}

/**
 * The SDK's store, watched for the `state` it saves and reads back (the one
 * it checks a redirect against), whose writes stop once the server was signed
 * out (`guard`, checked right before the SDK's synchronous write).
 */
function watchedStore(store: McpOAuthStateStore, flow: Flow, guard: McpSignInWriteGuard): McpOAuthStateStore {
  const note = (state: unknown) => {
    const value = isRecord(state) ? state.oauthState : undefined;
    flow.storedState = typeof value === "string" ? value : undefined;
  };
  return {
    load: async () => {
      const state = await store.load();
      note(state);
      return state;
    },
    save: async (state) => {
      guard();
      note(state);
      await store.save(state);
    },
  };
}

function showAuthorizationUrl(flow: Flow, url: URL): void {
  if (isEnded(flow)) return;
  flow.sawPage = true;
  flow.authorizationUrl = url.href;
  const redirect = url.searchParams.get("redirect_uri");
  if (redirect) flow.redirectUrl = redirect;
  // The SDK reads the stored `state` back right before it shows the page, and compares a redirect with that.
  flow.expectedState = flow.storedState ?? url.searchParams.get("state") ?? undefined;
  setPhase(flow, "authorize");
}

/**
 * The SDK's prompt for a pasted address. It resolves with what
 * `pasteMcpSignInRedirect()` accepted, with "" when the flow ends (a cancel or
 * the time limit, also one that came before this was asked), or with nothing
 * once the SDK aborts it because the loopback callback brought the code.
 */
function askForRedirect(flow: Flow, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (flow.prompt === settle) flow.prompt = undefined;
      resolve(value);
    };
    function onAbort() {
      // The browser reached the loopback listener: the code is being exchanged.
      if (flow.phase === "authorize") setPhase(flow, "finishing");
      settle(undefined);
    }
    if (isEnded(flow)) {
      settle("");
      return;
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    flow.prompt = settle;
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Records what a connect found as the entry's status, as a test would, and returns it as a result. */
function record(flow: Flow, run: McpTestRun): McpTestResult {
  const result: McpTestResult = { ...run, testedAt: Date.now() };
  recordMcpStatus(flow.target, flow.target.configKey, { ...result, origin: "test" });
  return result;
}

async function runFlow(flow: Flow, deps: McpSignInDeps): Promise<void> {
  const { tails } = registry();
  const previous = tails.get(flow.key) ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => finished);
  tails.set(flow.key, tail);
  let connection: McpSignInConnection | undefined;
  const redact = (text: string) => (connection ? connection.redact(text) : text);
  const guard = writeGuard(flow);
  try {
    // A run of the same server still unwinding goes first: two at once would overwrite each other's
    // verifier and state in mcp-auth.json.
    await previous;
    if (isEnded(flow)) return;
    connection = deps.open(flow.target, guard);

    // 1. Connect, to learn whether the server asks for a sign-in, and its challenge.
    const first = await connection.connect(flow.controller.signal);
    // Stopped by a cancel or the time limit: what it found says nothing about the server.
    if (isEnded(flow)) return;
    if (first.queueTimedOut) {
      end(flow, "failed", { failure: "queue-timed-out" });
      return;
    }
    const firstResult = record(flow, first);
    if (first.state === "connected") {
      end(flow, "done", { alreadySignedIn: true, result: firstResult });
      return;
    }
    if (first.state !== "needs-auth") {
      end(flow, "failed", { failure: "connect-failed", result: firstResult });
      return;
    }
    let settings: McpOAuthSettings;
    try {
      settings = connection.oauthSettings();
    } catch (error) {
      end(flow, "failed", { failure: "sign-in-failed", error: maskStatusError(errorMessage(error), redact) });
      return;
    }

    // 2. The SDK's sign-in: discovery, registration, the page, the code, the tokens.
    setPhase(flow, "starting");
    try {
      await deps.signIn({
        serverUrl: flow.target.url,
        store: watchedStore(deps.store(flow.target.name, flow.target.url), flow, guard),
        settings,
        challenge: connection.challenge,
        prompt: {
          showAuthorizationUrl: (url) => showAuthorizationUrl(flow, url),
          promptForRedirectUrl: (signal) => askForRedirect(flow, signal),
        },
      });
    } catch (error) {
      if (isEnded(flow)) return;
      if (deps.isCancelled(error) || error instanceof McpSignedOutError) end(flow, "cancelled");
      else end(flow, "failed", { failure: "sign-in-failed", error: maskStatusError(errorMessage(error), redact) });
      return;
    }
    if (isEnded(flow)) return;
    // A stored refresh token renews the tokens without ever showing a page.
    const refreshed = flow.sawPage ? {} : { refreshed: true as const };

    // 3. Connect again with the new tokens, and record what the server offers.
    setPhase(flow, "finishing");
    if (flow.target.mayConnect && !flow.target.mayConnect()) {
      end(flow, "done", refreshed);
      return;
    }
    const after = await connection.reconnect(flow.controller.signal);
    if (isEnded(flow)) return;
    if (after.queueTimedOut) {
      end(flow, "done", refreshed);
      return;
    }
    end(flow, "done", { ...refreshed, result: record(flow, { ...after, afterSignIn: true }) });
  } catch (error) {
    end(flow, "failed", { failure: "internal", error: maskStatusError(errorMessage(error), redact) });
  } finally {
    // The SDK's callback listener is closed by signInMcpServer itself; this closes the connection, briefly.
    if (connection) await connection.close().catch(() => undefined);
    release();
    void tail.then(() => {
      if (tails.get(flow.key) === tail) tails.delete(flow.key);
    });
  }
}

/** Ends the flow as expired at `ms`, unless it then has its code: that gets one grace period to finish. */
function armExpiry(flow: Flow, ms: number): void {
  flow.expiry = setTimeout(() => {
    if (flow.phase === "finishing" && !flow.graced) {
      flow.graced = true;
      flow.expiresAt = Date.now() + flow.graceMs;
      armExpiry(flow, flow.graceMs);
      return;
    }
    end(flow, "expired");
  }, ms);
  flow.expiry.unref?.();
}

export interface McpSignInStartOptions {
  /** The time limit; `MCP_SIGN_IN_TTL_MS` by default. */
  ttlMs?: number;
  /** How long an ended flow stays readable; `MCP_SIGN_IN_KEEP_MS` by default. */
  keepMs?: number;
  /** `MCP_SIGN_IN_FINISH_GRACE_MS` by default. */
  finishGraceMs?: number;
}

/**
 * Starts signing in to `target`, or joins the sign-in under way for its name
 * and URL (`joined`). Answers at once: the flow runs in the background and is
 * read with `readMcpSignIn()`.
 */
export function startMcpSignIn(
  target: McpSignInTarget,
  deps: McpSignInDeps,
  options: McpSignInStartOptions = {},
): { flow: McpSignInFlowInfo; joined: boolean } {
  const { flows, active } = registry();
  const key = mcpSignInKey(target.name, target.url);
  const activeId = active.get(key);
  const existing = activeId === undefined ? undefined : flows.get(activeId);
  if (existing && !isEnded(existing)) return { flow: describeFlow(existing), joined: true };

  const ttlMs = options.ttlMs ?? MCP_SIGN_IN_TTL_MS;
  const flow: Flow = {
    id: randomUUID(),
    key,
    target,
    signOutsAtStart: mcpSignOutCount(key),
    phase: "connecting",
    expiresAt: Date.now() + ttlMs,
    keepMs: options.keepMs ?? MCP_SIGN_IN_KEEP_MS,
    graceMs: options.finishGraceMs ?? MCP_SIGN_IN_FINISH_GRACE_MS,
    controller: new AbortController(),
    sawPage: false,
  };
  flows.set(flow.id, flow);
  active.set(key, flow.id);
  prune(flows);
  armExpiry(flow, ttlMs);
  void runFlow(flow, deps);
  return { flow: describeFlow(flow), joined: false };
}

/** A flow as the browser polls it; undefined once it is forgotten (`MCP_SIGN_IN_KEEP_MS` after it ended) or unknown. */
export function readMcpSignIn(flowId: string): McpSignInFlowInfo | undefined {
  const flow = registry().flows.get(flowId);
  return flow ? describeFlow(flow) : undefined;
}

export type McpSignInPasteResult =
  | { ok: true; flow: McpSignInFlowInfo }
  | { ok: false; status: number; reason: McpRefusalReason; error: string; flow?: McpSignInFlowInfo };

/**
 * Hands a pasted redirected address to the SDK's waiting prompt, after the
 * checks the SDK would end the whole sign-in on: a URL, this sign-in's
 * `state`, no `error` answer, and a `code`. A refused paste leaves the flow
 * waiting, so a typo or the wrong tab costs nothing.
 */
export function pasteMcpSignInRedirect(flowId: string, input: unknown): McpSignInPasteResult {
  const flow = registry().flows.get(flowId);
  if (!flow) return { ok: false, status: 404, reason: "sign-in-unknown", error: "No sign-in has that id: it ended over a minute ago, or Pi Web restarted" };
  const refuse = (status: number, reason: McpRefusalReason, error: string): McpSignInPasteResult => ({ ok: false, status, reason, error, flow: describeFlow(flow) });
  if (typeof input !== "string" || !input.trim() || input.length > MCP_SIGN_IN_MAX_PASTE_CHARS) {
    return refuse(400, "invalid-request", `redirectUrl must be the redirected address, at most ${MCP_SIGN_IN_MAX_PASTE_CHARS} characters`);
  }
  const prompt = flow.prompt;
  if (!prompt || flow.phase !== "authorize") {
    return refuse(409, "sign-in-not-waiting", `The sign-in is ${flow.phase}, not waiting for a redirected address`);
  }
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse(400, "redirect-invalid", "Expected the full redirected address from the browser's address bar");
  }
  if (flow.expectedState === undefined || url.searchParams.get("state") !== flow.expectedState) {
    return refuse(400, "redirect-state-mismatch", "The address belongs to a different sign-in");
  }
  const denied = url.searchParams.get("error");
  if (denied) {
    const description = url.searchParams.get("error_description") ?? denied;
    return refuse(400, "redirect-denied", description.length > DENIAL_MAX_CHARS ? `${description.slice(0, DENIAL_MAX_CHARS - 1)}…` : description);
  }
  if (!url.searchParams.get("code")) return refuse(400, "redirect-no-code", "The address does not contain an authorization code");
  setPhase(flow, "finishing");
  prompt(text);
  return { ok: true, flow: describeFlow(flow) };
}

/** Cancels a flow (an ended one stays as it ended); undefined when it is unknown. */
export function cancelMcpSignIn(flowId: string): McpSignInFlowInfo | undefined {
  const flow = registry().flows.get(flowId);
  if (!flow) return undefined;
  end(flow, "cancelled");
  return describeFlow(flow);
}

/** Cancels the sign-in under way for server `name` at `url`, if any. */
export function cancelMcpSignInsFor(name: string, url: string): void {
  const { flows, active } = registry();
  const id = active.get(mcpSignInKey(name, url));
  const flow = id === undefined ? undefined : flows.get(id);
  if (flow) end(flow, "cancelled");
}

/**
 * Signs server `name` out of `url` as `pi mcp logout` does
 * (`credentials.remove(name, url)`): deletes its tokens and client
 * registration from `mcp-auth.json` (the legacy record by URL alone when it
 * has none of its own), answering whether it held any. First every run of the
 * server started before now is barred from writing (its stores throw
 * `McpSignedOutError`): a sign-in's, and a Test's (`lib/mcp-test.ts`). The
 * active sign-in is also cancelled, and only then the credentials go: a cancel alone
 * does not stop a code exchange or a refresh already on its way, which would
 * store tokens right after the removal. A missing file is not created just to
 * find nothing in it. Open sessions read the store on every request, so they
 * lose access at their next one; a refresh one of them already has on its way
 * is theirs, as it is for `pi mcp logout`.
 */
export function signOutMcpServer(
  name: string,
  url: string,
  agentDir: string,
  internals: Pick<PiSdkInternals, "McpOAuthCredentialStore">,
): boolean {
  noteMcpSignOut(mcpSignInKey(name, url));
  cancelMcpSignInsFor(name, url);
  if (!existsSync(join(agentDir, "mcp-auth.json"))) return false;
  return new internals.McpOAuthCredentialStore().remove(name, url);
}

/** Ends and forgets every flow; for tests. */
export function clearMcpSignIns(): void {
  const { flows, active, tails } = registry();
  for (const flow of flows.values()) end(flow, "cancelled");
  flows.clear();
  active.clear();
  tails.clear();
}
