import { EventEmitter } from "node:events";
import * as undici from "undici";
import type { EffectiveNetworkProxyConfig, ProxySettings } from "@/lib/network-proxy";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherState?: {
    fingerprint: string;
    dispatcher: undici.Dispatcher;
  };
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};
let applyQueue = Promise.resolve();

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

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

function normalizeTimeout(timeoutMs: number): number {
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }
  return normalizedTimeoutMs;
}

function environmentProxySettings(): ProxySettings {
  const allProxy = process.env.ALL_PROXY ?? process.env.all_proxy;
  const httpProxy = process.env.HTTP_PROXY ?? process.env.http_proxy ?? allProxy;
  const httpsProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? allProxy;
  return {
    enabled: Boolean(httpProxy || httpsProxy),
    httpProxy,
    httpsProxy,
    noProxy: process.env.NO_PROXY ?? process.env.no_proxy ?? "localhost,127.0.0.1,::1",
  };
}

export function createHttpDispatcher(
  settings: ProxySettings,
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): undici.Dispatcher {
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs);
  const commonOptions = {
    allowH2: false,
    bodyTimeout: normalizedTimeoutMs,
    headersTimeout: normalizedTimeoutMs,
    clientFactory: createUndiciClient,
    factory: createUndiciOriginDispatcher,
  };

  if (!settings.enabled || (!settings.httpProxy && !settings.httpsProxy)) {
    return withUndiciErrorListener(new undici.Agent({
      ...commonOptions,
      factory: createUndiciOriginDispatcher,
    }));
  }

  return withUndiciErrorListener(new undici.EnvHttpProxyAgent({
    ...commonOptions,
    httpProxy: settings.httpProxy,
    httpsProxy: settings.httpsProxy,
    noProxy: settings.noProxy,
  }));
}

function dispatcherFingerprint(settings: ProxySettings, timeoutMs: number): string {
  return JSON.stringify({
    timeoutMs: normalizeTimeout(timeoutMs),
    enabled: settings.enabled,
    httpProxy: settings.httpProxy ?? "",
    httpsProxy: settings.httpsProxy ?? "",
    noProxy: settings.noProxy,
  });
}

export function applyHttpDispatcher(
  settings: ProxySettings,
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): boolean {
  const fingerprint = dispatcherFingerprint(settings, timeoutMs);
  const current = dispatcherGlobal.__piWebHttpDispatcherState;
  if (current?.fingerprint === fingerprint) return false;

  const dispatcher = createHttpDispatcher(settings, timeoutMs);
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherState = { fingerprint, dispatcher };
  // Do not close the previous dispatcher here. It may still own a long-running
  // streaming model response; the process will reclaim retired dispatchers on exit.
  return true;
}

export function applyEffectiveProxyConfiguration(
  settings: EffectiveNetworkProxyConfig,
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): Promise<boolean> {
  const next = applyQueue.then(() => applyHttpDispatcher(settings, timeoutMs));
  applyQueue = next.then(() => undefined, () => undefined);
  return next;
}

/** Backward-compatible environment-only configuration entrypoint. */
export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherState) return;
  applyHttpDispatcher(environmentProxySettings(), timeoutMs);
}
