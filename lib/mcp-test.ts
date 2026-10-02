import type { McpExposure, McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import type { McpScope, McpTestResult, McpTestState, McpTestTool } from "./api-types";
import {
  argSecretParts,
  commandSecretParts,
  isReferenceOnly,
  maskArgs,
  maskCommand,
  maskUrl,
  SECRET_MASK,
  urlSecretParts,
} from "./mcp-secrets";
import { guardedCredentialStore, mcpOAuthUrl, mcpSignInUrlKey, mcpSignOutCount, mcpSignOutGuard, type McpSignInWriteGuard } from "./mcp-sign-out";
import { recordMcpStatus } from "./mcp-status";
import { createPiWebMcpTransportFactory, resolvedConfigValues } from "./mcp-transport";
import type {
  McpClient,
  McpOAuthCredentialStore,
  McpServerConnection,
  McpTool,
  McpTransport,
  PiSdkInternals,
  StdioTransport,
} from "./pi-sdk-internals";

// Settings › MCP's Test (ADR 0006): connect one `mcp.json` entry once, outside
// any session, list what it offers, and close it again. It connects the way a
// session does — the SDK's `McpServerConnection`, Pi Web's transport factory
// (scrubbed environment, PI_WEB_PASSWORD refused), the default OAuth store in
// `mcp-auth.json` — so what it finds is what a session would find. The route
// (`app/api/mcp/test/route.ts`) decides whether an entry may be tested at all
// and reads it from the file; nothing here takes a config from the browser.
//
// Bounding it is the point of most of this file:
// - Every request (`initialize`, `tools/list`, …) gets min(the entry's
//   `timeout`, 15 s) instead of the SDK's 60 s default.
// - The whole test has a deadline (20 s). At the deadline, or once every
//   caller gave up, the transports are closed directly: that fails the
//   pending handshake at once, while `connection.close()` alone only sets a
//   flag and leaves a stdio child running until its request times out.
// - Closing is awaited only for `MCP_TEST_CLOSE_WAIT_MS`. A stdio close waits
//   for the child's `close` event, which a grandchild outside its process
//   group can hold off for ever, and `connection.close()` waits for an OAuth
//   refresh. They go on in the background; the answer never waits on them.
// - A `!command` value runs synchronously (`execSync`, up to 10 s) and blocks
//   the event loop, timers included, so no deadline can interrupt one. Tests
//   of entries holding one run one at a time (a globalThis queue), so a burst
//   of presses cannot stack those blocks.
// - Presses on the same entry while its test runs join that test; one every
//   caller gave up on is let go at once, so the next press starts afresh.

/** Each request's timeout, at most: the SDK's default is 60 s, too long to wait for in a panel. */
export const MCP_TEST_REQUEST_TIMEOUT_MS = 15_000;
/** The whole test, from connecting to a result; a wait in the queue gets as long again. */
export const MCP_TEST_DEADLINE_MS = 20_000;
/** How long the answer waits for the server to close before leaving that to the background. */
export const MCP_TEST_CLOSE_WAIT_MS = 2_000;
/** Tools a result lists; `toolCount` still counts all of them. */
export const MCP_TEST_MAX_TOOLS = 500;

const SDK_DEFAULT_TIMEOUT_SECONDS = 60;
/** The end of a stdio server's stderr a result keeps. */
const STDERR_TAIL_CHARS = 2_000;
/** The start of an error message a result keeps: a JSON-RPC error or an HTTP body may run to megabytes. */
const ERROR_MAX_CHARS = 2_000;
/**
 * How much of a message is masked before it is shortened: masking first means
 * a secret the cut would halve is still found whole. The transport keeps at
 * most 64 KiB of stderr; an error message is cut to this first.
 */
const REDACT_WINDOW_CHARS = 64 * 1024;
const TEXT_MAX_CHARS = 300;
/** Literal and resolved values shorter than this are not masked in messages: no secret is this short, and masking `1` or `true` would garble them. */
const MASK_MIN_LENGTH = 6;
/** The SDK's words before the text of a `!command` that failed (`resolveConfigValueOrThrow()`). */
const SHELL_COMMAND_QUOTE = "from shell command: ";
const EXPOSURES: ReadonlySet<string> = new Set<McpExposure>(["codemode", "codemode-deferred", "deferred", "direct", "hidden"]);

export type McpTestInternals = Pick<
  PiSdkInternals,
  | "McpServerConnection"
  | "McpOAuthCredentialStore"
  | "createDefaultTransport"
  | "StdioTransport"
  | "getConfigValueEnvVarNames"
  | "isCommandConfigValue"
  | "getMcpToolExposure"
>;

/** The entry to test, as the route read and validated it from its file. */
export interface McpTestTarget {
  scope: McpScope;
  name: string;
  /** The configured path of its file; with `scope` and `name` the key of its status. */
  sourcePath: string;
  /** `mcpConfigKey()` of the raw entry: the status is shown only while the file holds this entry. */
  configKey: string;
  /** The entry as the SDK's validator returned it. */
  config: McpServerConfig;
  /** The folder the connection runs in: a stdio server's working directory and the MCP root it is sent. */
  cwd: string;
}

/** What connecting found, before the queue and the clock are added. */
export type McpTestRun = Omit<McpTestResult, "testedAt" | "queuedMs">;

/** Connects `target` until `signal` aborts; replaced in tests of the queue. */
export type McpTestConnect = (target: McpTestTarget, signal: AbortSignal) => Promise<McpTestRun>;

export interface McpTestOptions {
  /** The caller's request; a test that every caller gave up on is stopped and not recorded. */
  signal?: AbortSignal;
  deadlineMs?: number;
  requestTimeoutMs?: number;
  closeWaitMs?: number;
  /** Replaces connecting (tests); the queue, joining, the deadline and recording stay. */
  connect?: McpTestConnect;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The start of a message, masked and then shortened. */
function headOf(text: string, redact: (text: string) => string, max: number): string {
  return clip(redact(text.slice(0, REDACT_WINDOW_CHARS)), max);
}

/** The end of a stderr tail, masked and then shortened. */
function tailOf(text: string, redact: (text: string) => string, max: number): string {
  return redact(text.slice(-REDACT_WINDOW_CHARS)).slice(-max);
}

/** A status's `error`, as a test and a session's MCP host record it: masked, then its start. */
export function maskStatusError(text: string, redact: (text: string) => string): string {
  return headOf(text, redact, ERROR_MAX_CHARS);
}

/** A status's `stderr`, as a test and a session's MCP host record it: masked, then its end. */
export function maskStatusStderr(text: string, redact: (text: string) => string): string {
  return tailOf(text, redact, STDERR_TAIL_CHARS);
}

/** Whether connecting resolves a `!command`: in a stdio entry's env, an HTTP entry's headers or `oauth.clientSecret`. */
export function runsShellCommand(config: unknown, internals: Pick<PiSdkInternals, "isCommandConfigValue">): boolean {
  return resolvedConfigValues(config).some(({ value }) => internals.isCommandConfigValue(value));
}

// ---------------------------------------------------------------------------
// Masking what reaches the browser
// ---------------------------------------------------------------------------

const AUTHORIZATION_SCHEME = /^(?:bearer|basic|token)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One text to replace: everywhere, or (`word`) only where it is not part of a longer word. */
interface Replacement {
  raw: string;
  shown: string;
  word: boolean;
}

/**
 * Replaces, in a message or a stderr tail, what the masking rule keeps from
 * the browser: the text of a `!command` where the SDK quotes it, the literal
 * env and header values and `oauth.clientSecret`, what the transports resolved
 * them to (a token a `${VAR}` read), and the parts of the command, arguments
 * and URL that GET masks, also where one of them is quoted on its own (a key
 * from the URL's query, a userinfo password, the URL as `new URL()` spells it).
 * A server that echoes one is not trusted to keep it out of its own output,
 * nor out of the tool descriptions and server info it sends.
 *
 * A whole secret is replaced wherever it appears. Words split from a value
 * (`Bearer <token>`) are replaced only as words, so a short word of a command
 * or a phrase never garbles a longer one (`auth` in `authentication`). A
 * `!command`'s stderr is discarded by the SDK, so its text can only appear
 * where the SDK quotes it after `from shell command: `; elsewhere it is
 * replaced as a word from 6 characters, so `!env` never masks `env` in the
 * SDK's own `env "TOKEN"`.
 */
export function createTestRedactor(
  config: McpServerConfig,
  transports: readonly McpTransport[],
  internals: Pick<PiSdkInternals, "isCommandConfigValue">,
  /** Values resolved outside the transports, such as the `oauth.clientSecret` a sign-in resolved. */
  resolvedSecrets: readonly string[] = [],
): (text: string) => string {
  const replacements = new Map<string, Replacement>();
  const add = (raw: string, shown: string, word: boolean) => {
    const existing = replacements.get(raw);
    // A text found both ways is replaced everywhere.
    if (!existing || (existing.word && !word)) replacements.set(raw, { raw, shown, word });
  };
  const secret = (value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length >= MASK_MIN_LENGTH) add(trimmed, SECRET_MASK, false);
    // `Bearer <token>`: the token alone may be echoed.
    for (const word of trimmed.split(/\s+/)) {
      if (word !== trimmed && word.length >= MASK_MIN_LENGTH && !AUTHORIZATION_SCHEME.test(word)) add(word, SECRET_MASK, true);
    }
  };
  const masked = (raw: string, shown: { value: string; masked: boolean }) => {
    if (shown.masked && raw.length >= MASK_MIN_LENGTH) add(raw, shown.value, false);
  };
  for (const { value } of resolvedConfigValues(config)) {
    if (internals.isCommandConfigValue(value)) {
      const text = value.slice(1);
      if (text.trim()) add(`${SHELL_COMMAND_QUOTE}${text}`, `${SHELL_COMMAND_QUOTE}${SECRET_MASK}`, false);
      if (text.trim().length >= MASK_MIN_LENGTH) add(text.trim(), SECRET_MASK, true);
    } else if (!isReferenceOnly(value)) {
      secret(value);
    }
  }
  const resolved = transports.map((transport) =>
    (transport as { options?: { env?: Record<string, string>; headers?: Record<string, string> } }).options ?? {});
  if ("url" in config) {
    for (const options of resolved) for (const value of Object.values(options.headers ?? {})) secret(value);
    masked(config.url, maskUrl(config.url));
    try {
      // `new URL()` adds the `/` of an empty path and lowercases the host, and messages quote it that way.
      const href = new URL(config.url).href;
      if (href !== config.url) masked(href, maskUrl(href));
    } catch {
      // Not a URL the SDK could have fetched; the raw text is all a message can quote.
    }
    for (const part of urlSecretParts(config.url)) secret(part);
  } else {
    // Only the entry's own names: the rest of a stdio server's environment is the host's, sanitized.
    for (const options of resolved) for (const name of Object.keys(config.env ?? {})) secret(options.env?.[name]);
    masked(config.command, maskCommand(config.command));
    for (const part of commandSecretParts(config.command)) secret(part);
    const args = config.args ?? [];
    const shown = maskArgs(args).args;
    args.forEach((arg, index) => masked(arg, { value: shown[index] ?? SECRET_MASK, masked: shown[index] !== arg }));
    for (const part of argSecretParts(args)) secret(part);
  }
  for (const value of resolvedSecrets) secret(value);
  // Longest first, so a value is never left half replaced by a shorter one inside it.
  const ordered = [...replacements.values()]
    .sort((a, b) => b.raw.length - a.raw.length)
    .map(({ raw, shown, word }) => ({
      shown,
      // Word characters on either side mean `raw` is part of a longer word, which a word replacement leaves alone.
      pattern: new RegExp(word ? `(?<![A-Za-z0-9_])${escapeRegExp(raw)}(?![A-Za-z0-9_])` : escapeRegExp(raw), "g"),
    }));
  return (text) => ordered.reduce((current, { pattern, shown }) => current.replace(pattern, () => shown), text);
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * How a tool reaches the model, as `getMcpToolExposure()` decides it, read
 * from a copy of `toolExposure` with no prototype: the SDK looks a name up
 * with a plain index, so a tool named `constructor` or `toString` would get
 * `Object.prototype`'s function. Anything but an exposure falls back to the
 * server's.
 */
function toolExposure(config: McpServerConfig, name: string, internals: Pick<PiSdkInternals, "getMcpToolExposure">): McpExposure {
  const overrides: Record<string, McpExposure> = Object.assign(Object.create(null), config.toolExposure);
  const exposure: unknown = internals.getMcpToolExposure({ ...config, toolExposure: overrides }, name);
  return typeof exposure === "string" && EXPOSURES.has(exposure) ? (exposure as McpExposure) : config.exposure ?? "codemode";
}

/**
 * One listed tool. pi-mcp checks only a tool's `name` and `inputSchema`, so
 * every other field is whatever the server sent: only strings are read.
 */
function describeTool(
  tool: McpTool,
  config: McpServerConfig,
  internals: Pick<PiSdkInternals, "getMcpToolExposure">,
  redact: (text: string) => string,
): McpTestTool {
  const annotations: Partial<NonNullable<McpTool["annotations"]>> =
    typeof tool.annotations === "object" && tool.annotations !== null ? tool.annotations : {};
  const text = [tool.description, tool.title, annotations.title].find((value): value is string => typeof value === "string") ?? "";
  const description = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return {
    name: headOf(tool.name, redact, TEXT_MAX_CHARS),
    ...(description ? { description: headOf(description, redact, TEXT_MAX_CHARS) } : {}),
    readOnly: annotations.readOnlyHint === true,
    exposure: toolExposure(config, tool.name, internals),
  };
}

/** What the server said about itself; pi-mcp checks that `name` and `version` are strings. */
function describeServerInfo(info: NonNullable<McpClient["serverInfo"]>, redact: (text: string) => string): NonNullable<McpTestResult["serverInfo"]> {
  return {
    name: headOf(String(info.name ?? ""), redact, TEXT_MAX_CHARS),
    version: headOf(String(info.version ?? ""), redact, TEXT_MAX_CHARS),
    ...(typeof info.title === "string" && info.title ? { title: headOf(info.title, redact, TEXT_MAX_CHARS) } : {}),
  };
}

/**
 * The SDK appends a stdio server's stderr tail to its message (`<message>\n<tail>`).
 * The tail goes to `stderr` on its own, from the transport, which may have
 * received more since (at most 64 KiB); the message keeps the part before it.
 * Neither is masked or shortened yet.
 */
function splitStderr(message: string, stdio: StdioTransport | undefined): { error: string; stderr?: string } {
  const full = stdio?.stderr.trim() ?? "";
  if (!full) return { error: message };
  for (let index = message.indexOf("\n"); index >= 0; index = message.indexOf("\n", index + 1)) {
    const tail = message.slice(index + 1);
    if (tail && full.includes(tail)) return { error: message.slice(0, index), stderr: full };
  }
  return { error: message, stderr: full };
}

/**
 * One entry's connection as a test opens it: the SDK's `McpServerConnection`
 * through Pi Web's transport factory, with every transport it creates kept so
 * that closing can reach them directly. Settings › MCP's sign-in
 * (`lib/mcp-sign-in.ts`) opens its connection the same way and keeps it from
 * the first connect, which records the server's OAuth challenge, through the
 * reconnect after it stored the new tokens.
 */
export interface McpTestConnection {
  connection: McpServerConnection;
  /** Every transport the connection created, in order: the last one is the current. */
  transports: McpTransport[];
}

/** Builds the connection; nothing is started or contacted until it is asked for a client. */
export function openTestConnection(
  target: McpTestTarget,
  internals: McpTestInternals,
  options: {
    requestTimeoutMs?: number;
    /** The store the connection reads and refreshes tokens through; the default one when omitted. */
    credentials?: McpOAuthCredentialStore;
  } = {},
): McpTestConnection {
  const requestTimeoutMs = options.requestTimeoutMs ?? MCP_TEST_REQUEST_TIMEOUT_MS;
  const { config } = target;
  const timeout = Math.min(config.timeout ?? SDK_DEFAULT_TIMEOUT_SECONDS, requestTimeoutMs / 1000);
  const entry: McpServerEntry = { name: target.name, config: { ...config, timeout }, source: target.sourcePath, scope: target.scope };
  const transports: McpTransport[] = [];
  const factory = createPiWebMcpTransportFactory(internals);
  const connection = new internals.McpServerConnection({
    entry,
    cwd: target.cwd,
    createTransport: (...args) => {
      const transport = factory(...args);
      transports.push(transport);
      return transport;
    },
    // The default store, `mcp-auth.json` in the agent dir: the one sessions and the pi CLI use. A
    // sign-in passes one over the same file whose writes stop once its URL is signed out.
    credentials: options.credentials ?? new internals.McpOAuthCredentialStore(),
    onTools: () => {},
  });
  return { connection, transports };
}

/**
 * Starts closing everything the connection opened and waits at most `waitMs`.
 * `connection.close()` marks the connection closed before its first await,
 * which also ends an HTTP retry waiting between attempts; closing the
 * transports directly fails a handshake still in progress.
 */
export async function closeTestConnection({ connection, transports }: McpTestConnection, waitMs: number = MCP_TEST_CLOSE_WAIT_MS): Promise<void> {
  const closing = [connection.close(), ...transports.map((transport) => transport.close())]
    .map((promise) => promise.catch(() => undefined));
  const wait = delay(waitMs);
  await Promise.race([Promise.all(closing), wait.promise]);
  wait.cancel();
}

/**
 * What one attempt to connect found, read from the connection before anything
 * closes it (closing sets its state to "closed"): `attempt` settles, or
 * `signal` aborts, which reads as no answer. The attempt is the first connect
 * by default; a sign-in passes its reconnect. Everything server-written is
 * masked with `createTestRedactor()`, plus `resolvedSecrets`.
 */
export async function observeTestConnection(
  { connection, transports }: McpTestConnection,
  target: McpTestTarget,
  internals: McpTestInternals,
  signal: AbortSignal,
  options: { attempt?: () => Promise<McpClient>; resolvedSecrets?: readonly string[] } = {},
): Promise<McpTestRun> {
  const { config } = target;
  const attempt = options.attempt ?? (() => connection.getClient());
  const started = Date.now();
  type Outcome = { client: McpClient } | { error: unknown } | { aborted: true };
  const outcome: Outcome = signal.aborted
    ? { aborted: true }
    : await Promise.race([
        attempt().then((client): Outcome => ({ client }), (error: unknown): Outcome => ({ error })),
        aborted(signal).then((): Outcome => ({ aborted: true })),
      ]);
  const durationMs = Date.now() - started;

  const stdioTransports = transports.filter((transport): transport is StdioTransport => transport instanceof internals.StdioTransport);
  const stdio = stdioTransports[stdioTransports.length - 1];
  const redact = createTestRedactor(config, transports, internals, options.resolvedSecrets);
  const isStdio = !("url" in config);
  const cwd = isStdio ? { cwd: stdio?.options.cwd ?? target.cwd } : {};
  if ("aborted" in outcome) {
    const stderr = stdio?.stderr.trim();
    return {
      state: "failed",
      timedOut: true,
      tools: [],
      toolCount: 0,
      durationMs,
      ...cwd,
      ...(stderr ? { stderr: tailOf(stderr, redact, STDERR_TAIL_CHARS) } : {}),
    };
  }
  const state: McpTestState = connection.state === "connected"
    ? "connected"
    : connection.state === "needs-auth" ? "needs-auth" : "failed";
  const tools = state === "connected" ? connection.tools : [];
  const client = "client" in outcome ? outcome.client : undefined;
  const run: McpTestRun = {
    state,
    tools: tools.slice(0, MCP_TEST_MAX_TOOLS).map((tool) => describeTool(tool, config, internals, redact)),
    toolCount: tools.length,
    durationMs,
    ...cwd,
    ...(state === "connected" && connection.hasResources
      ? { resources: connection.resources.length, resourceTemplates: connection.resourceTemplates.length }
      : {}),
    ...(client?.serverInfo ? { serverInfo: describeServerInfo(client.serverInfo, redact) } : {}),
  };
  if (state === "failed") {
    const message = connection.error ?? ("error" in outcome ? errorMessage(outcome.error) : "The connection failed");
    const { error, stderr } = splitStderr(message, stdio);
    run.error = headOf(error, redact, ERROR_MAX_CHARS);
    if (stderr) run.stderr = tailOf(stderr, redact, STDERR_TAIL_CHARS);
  }
  return run;
}

/**
 * The SDK's connection to one entry through Pi Web's transport factory, until
 * it settles or `signal` aborts. With `guard`, an OAuth entry's connection
 * reads and refreshes tokens through `guardedCredentialStore()`, as a
 * sign-in's does: a refresh still on its way when the URL is signed out
 * stores nothing afterwards.
 */
export async function connectForTest(
  target: McpTestTarget,
  internals: McpTestInternals,
  signal: AbortSignal,
  options: { requestTimeoutMs?: number; closeWaitMs?: number; guard?: McpSignInWriteGuard } = {},
): Promise<McpTestRun> {
  const opened = openTestConnection(target, internals, {
    ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    ...(options.guard ? { credentials: guardedCredentialStore(internals, options.guard) } : {}),
  });
  // Whatever happens, the connection and its transports are closed: a result
  // that could not be built must not leave a stdio server running.
  try {
    return await observeTestConnection(opened, target, internals, signal);
  } finally {
    await closeTestConnection(opened, options.closeWaitMs ?? MCP_TEST_CLOSE_WAIT_MS);
  }
}

// ---------------------------------------------------------------------------
// The queue for entries that run a shell command, joining, the deadline
// ---------------------------------------------------------------------------

const FLIGHTS_KEY: symbol = Symbol.for("pi-web:mcp-test-flights");
const COMMAND_QUEUE_KEY: symbol = Symbol.for("pi-web:mcp-test-command-queue");
const CANCELLED = "cancelled";
const DEADLINE = "deadline";

function flights(): Map<string, Promise<McpTestResult> & { join: (signal?: AbortSignal) => void }> {
  const store = globalThis as Record<symbol, Map<string, Promise<McpTestResult> & { join: (signal?: AbortSignal) => void }> | undefined>;
  return (store[FLIGHTS_KEY] ??= new Map());
}

function commandQueue(): { tail: Promise<void> } {
  const store = globalThis as Record<symbol, { tail: Promise<void> } | undefined>;
  return (store[COMMAND_QUEUE_KEY] ??= { tail: Promise.resolve() });
}

/**
 * A place in the queue of tests that run a shell command: resolves once every
 * test ahead has released its place, `waitMs` passed, or `signal` aborted. A
 * test that gives up releases its place at once; the next one still waits for
 * the ones ahead of it. A sign-in of such an entry takes a place for each of
 * its connects, never across the wait for the browser.
 */
export async function takeMcpCommandSlot(signal: AbortSignal, waitMs: number): Promise<{ release: () => void; turn: boolean; timedOut: boolean }> {
  const queue = commandQueue();
  const ahead = queue.tail;
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.tail = ahead.then(() => done);
  const wait = delay(waitMs);
  const outcome = await Promise.race([
    ahead.then(() => "turn" as const),
    wait.promise.then(() => "timeout" as const),
    aborted(signal).then(() => "aborted" as const),
  ]);
  wait.cancel();
  if (outcome !== "turn") release();
  return { release, turn: outcome === "turn", timedOut: outcome === "timeout" };
}

/** The sign-out guard of a test of `target` starting now, for an entry that signs in with OAuth. */
function signOutGuardFor(target: McpTestTarget): McpSignInWriteGuard | undefined {
  const url = mcpOAuthUrl(target.config);
  if (url === undefined) return undefined;
  try {
    return mcpSignOutGuard(url);
  } catch {
    // Not a URL the store could key: it stores nothing for it either.
    return undefined;
  }
}

/** How often the entry's OAuth URL was signed out: a press after a sign-out never joins a test started before it. */
function signOutsOf(target: McpTestTarget): number {
  const url = mcpOAuthUrl(target.config);
  if (url === undefined) return 0;
  try {
    return mcpSignOutCount(mcpSignInUrlKey(url));
  } catch {
    return 0;
  }
}

function flightKey(target: McpTestTarget): string {
  return [target.scope, target.sourcePath, target.name, target.configKey, target.cwd, signOutsOf(target)].join("\0");
}

/**
 * Tests one entry, or joins its test already under way (same file, name,
 * content and folder). The result is recorded as the entry's status unless
 * every caller gave up first, or it never left the queue.
 */
export function testMcpServer(target: McpTestTarget, internals: McpTestInternals, options: McpTestOptions = {}): Promise<McpTestResult> {
  const key = flightKey(target);
  const running = flights();
  const existing = running.get(key);
  if (existing) {
    existing.join(options.signal);
    return existing;
  }
  // A test every caller gave up on is let go at once, while it still closes:
  // a press in that window starts a new test instead of joining one that will
  // only answer "no answer" and record nothing.
  const flight = startTest(target, internals, options, () => {
    if (running.get(key) === flight) running.delete(key);
  });
  running.set(key, flight);
  void flight.finally(() => {
    if (running.get(key) === flight) running.delete(key);
  }).catch(() => undefined);
  flight.join(options.signal);
  return flight;
}

function startTest(
  target: McpTestTarget,
  internals: McpTestInternals,
  options: McpTestOptions,
  onCancelled: () => void,
): Promise<McpTestResult> & { join: (signal?: AbortSignal) => void } {
  const deadlineMs = options.deadlineMs ?? MCP_TEST_DEADLINE_MS;
  const closeWaitMs = options.closeWaitMs ?? MCP_TEST_CLOSE_WAIT_MS;
  // Taken when the test starts: a sign-out from then on bars its token writes and its record.
  const guard = signOutGuardFor(target);
  const connect: McpTestConnect = options.connect
    ?? ((entry, signal) => connectForTest(entry, internals, signal, { requestTimeoutMs: options.requestTimeoutMs, closeWaitMs, guard }));
  const signedOutSince = (): boolean => {
    try {
      guard?.();
      return false;
    } catch {
      return true;
    }
  };
  const controller = new AbortController();
  // Callers still waiting; one without a signal never gives up.
  let waiting = 0;
  let unbounded = false;
  const listeners: [AbortSignal, () => void][] = [];
  const join = (signal?: AbortSignal) => {
    if (!signal) {
      unbounded = true;
      return;
    }
    waiting += 1;
    const leave = () => {
      waiting -= 1;
      if (waiting === 0 && !unbounded && !controller.signal.aborted) {
        controller.abort(CANCELLED);
        onCancelled();
      }
    };
    if (signal.aborted) leave();
    else {
      signal.addEventListener("abort", leave, { once: true });
      listeners.push([signal, leave]);
    }
  };

  const run = async (): Promise<McpTestResult> => {
    try {
      return await runTest();
    } finally {
      // Over: a caller that leaves now cannot abort anything.
      for (const [signal, leave] of listeners) signal.removeEventListener("abort", leave);
    }
  };

  const runTest = async (): Promise<McpTestResult> => {
    // Let the first caller join before anything can abort.
    await Promise.resolve();
    const queuedAt = Date.now();
    const serial = runsShellCommand(target.config, internals);
    const slot = serial ? await takeMcpCommandSlot(controller.signal, deadlineMs) : undefined;
    const queuedMs = serial ? Date.now() - queuedAt : 0;
    const finish = (result: McpTestRun, record: boolean): McpTestResult => {
      const full: McpTestResult = { ...result, testedAt: Date.now(), ...(queuedMs > 0 ? { queuedMs } : {}) };
      // A sign-out since the test started forgot the entry's statuses; what the test found with
      // the tokens it had then is not news about the server signed out of.
      if (record && !signedOutSince()) recordMcpStatus(target, target.configKey, { ...full, origin: "test" });
      return full;
    };
    const notRun = (extra: Partial<McpTestRun>): McpTestRun => ({ state: "failed", tools: [], toolCount: 0, durationMs: 0, ...extra });
    if (slot && !slot.turn) {
      // Never tested, so nothing is recorded: the entry's last real result stays.
      return finish(notRun(slot.timedOut ? { queueTimedOut: true } : {}), false);
    }
    const deadline = setTimeout(() => controller.abort(DEADLINE), deadlineMs);
    deadline.unref?.();
    const started = Date.now();
    try {
      // `connectForTest()` answers within closeWaitMs of an abort; this bounds a replacement that does not.
      const fallback = aborted(controller.signal)
        .then(() => delay(closeWaitMs + 500).promise)
        .then(() => notRun({ timedOut: true, durationMs: Date.now() - started }));
      const result = await Promise.race([connect(target, controller.signal), fallback]);
      // Stopped because every caller gave up: what it found says nothing about the server. A result
      // that settled first is real, even if the callers left while the server was closing.
      const cancelled = controller.signal.reason === CANCELLED && result.timedOut === true;
      return finish(result, !cancelled);
    } finally {
      clearTimeout(deadline);
      slot?.release();
    }
  };
  return Object.assign(run(), { join });
}
