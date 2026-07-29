import { EventEmitter } from "node:events";
import * as undici from "undici";
// Relative, not "@/lib/...": http-dispatcher.test.mjs loads this module through
// a jiti instance without tsconfig path aliases.
import { withTlsOverride } from "./tls-overrides";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

// Per-origin TLS overrides ride along here: an intranet model endpoint reached
// by IP needs its certificate checked against the SAN name, which is a connect
// option on the client for that origin only. Everything else passes through
// untouched and keeps Node's strict verification.
function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, withTlsOverride(origin, options) as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...withTlsOverride(origin, dispatcherOptions),
      factory: createUndiciClient,
    }),
  );
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: normalizedTimeoutMs,
      headersTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}
