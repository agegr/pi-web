import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as undici from "undici";
import { readRegularFileText } from "./regular-file";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcher?: {
    dispatcher: undici.EnvHttpProxyAgent;
    timeoutMs: number;
    httpProxy?: string;
    httpsProxy?: string;
  };
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

export function parseHttpProxy(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      // Undici's HTTP proxy client takes an origin.
      if (url.pathname !== "/" || url.search || url.hash) return undefined;
    } else if ((url.protocol !== "socks5:" && url.protocol !== "socks:") || !url.hostname) {
      return undefined;
    }
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    return value.trim();
  } catch {
    return undefined;
  }
}

/**
 * The agent directory pi keeps its global `settings.json` in, resolved as pi's
 * `getAgentDir()` resolves it. It is resolved here instead of through the SDK
 * because this module runs in Next.js instrumentation: importing the SDK there
 * costs about a second of startup time, while `undici` costs a tenth of one.
 */
export function defaultAgentDir(): string {
  let configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");

  // pi's normalizePath(): Git Bash, MSYS, Cygwin and WSL drive paths on
  // Windows, then `~`, then file: URLs. The value is not trimmed.
  if (process.platform === "win32") configured = windowsShellPath(configured);
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"))) {
    return join(homedir(), configured.slice(2));
  }
  if (/^file:\/\//.test(configured)) return fileURLToPath(configured);
  return configured;
}

/** pi's normalizeWindowsShellPath(): `/c/x`, `/mnt/c/x`, `/cygdrive/c/x` to `C:\x`. */
function windowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

function readSettingsFile(agentDir: string): Record<string, unknown> {
  try {
    const text = readRegularFileText(join(agentDir, "settings.json"));
    if (!text) return {};
    const settings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return settings && typeof settings === "object" ? settings : {};
  } catch {
    return {};
  }
}

/**
 * The global `httpIdleTimeoutMs`, read the way the pi CLI reads it, so a Web UI
 * session gets the HTTP idle timeout the user configured instead of the
 * built-in default. Only the global file counts: the dispatcher is configured
 * once at startup, before any project is selected, so a project's
 * `.pi/settings.json` cannot apply here.
 *
 * A missing file, a file that does not parse, an absent key, or a value the CLI
 * would reject yields `undefined`, which leaves `configureHttpDispatcher`'s own
 * default in place.
 */
export function readHttpIdleTimeoutMs(agentDir: string = defaultAgentDir()): number | undefined {
  return parseHttpIdleTimeoutMs(readSettingsFile(agentDir).httpIdleTimeoutMs);
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

export function configureHttpDispatcherFromSettings(agentDir: string = defaultAgentDir()): void {
  const settings = readSettingsFile(agentDir);
  configureHttpDispatcher(
    parseHttpIdleTimeoutMs(settings.httpIdleTimeoutMs),
    parseHttpProxy(settings.httpProxy),
  );
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  proxyUrl?: string,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcher) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }
  installHttpDispatcher(normalizedTimeoutMs, proxyUrl);
}

/** A replacement dispatcher inherits the timeout chosen at startup. */
export function setHttpProxy(proxyUrl: string | undefined): void {
  const proxy = parseHttpProxy(proxyUrl);
  if (proxy === undefined && proxyUrl?.trim()) throw new Error("Invalid proxy URL");
  const timeoutMs = dispatcherGlobal.__piWebHttpDispatcher?.timeoutMs
    ?? readHttpIdleTimeoutMs()
    ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS;
  installHttpDispatcher(timeoutMs, proxy);
}

function proxyForProtocol(variable: "http_proxy" | "https_proxy", proxyUrl?: string) {
  const upper = variable.toUpperCase();
  const lowerValue = process.env[variable];
  const envValue = lowerValue ?? process.env[upper];
  if (envValue === undefined) return { url: proxyUrl, source: "settings" };
  // Windows' environment is case-insensitive; use its conventional uppercase label.
  const source = lowerValue !== undefined && process.platform !== "win32" ? variable : upper;
  return { url: envValue, source };
}

export function resolveHttpProxies(proxyUrl?: string) {
  const http = proxyForProtocol("http_proxy", proxyUrl);
  const https = proxyForProtocol("https_proxy", proxyUrl);
  const httpSource = http.url ? http.source : "direct";
  // EnvHttpProxyAgent falls back to its HTTP agent when the HTTPS URL is empty.
  return {
    httpProxy: http.url,
    httpsProxy: https.url,
    sources: { http: httpSource, https: https.url ? https.source : httpSource },
  };
}

function installHttpDispatcher(normalizedTimeoutMs: number, proxyUrl?: string): void {
  const { httpProxy, httpsProxy } = resolveHttpProxies(proxyUrl);
  const previous = dispatcherGlobal.__piWebHttpDispatcher;
  if (previous && previous.httpProxy === httpProxy && previous.httpsProxy === httpsProxy) return;

  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      httpProxy,
      httpsProxy,
      allowH2: false,
      // Reach an http:// origin through a CONNECT tunnel, as the pi SDK's own
      // dispatcher does. A forwarded request is carried by a client that keeps
      // undici's own 300 s bodyTimeout, so `httpIdleTimeoutMs` would not apply
      // and a provider stream that stalls cannot be cut at the configured time.
      proxyTunnel: true,
      bodyTimeout: normalizedTimeoutMs,
      // Node's 250 ms default can terminate valid connection attempts on
      // high-latency routes; the pi CLI's dispatcher waits two seconds here.
      connect: { autoSelectFamilyAttemptTimeout: 2_000 },
      headersTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (!previous && globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }
  dispatcherGlobal.__piWebHttpDispatcher = { dispatcher, timeoutMs: normalizedTimeoutMs, httpProxy, httpsProxy };

  // close() drains active responses. New fetches already use the new dispatcher.
  previous?.dispatcher.close().catch((error) => console.warn("Failed to close the previous HTTP dispatcher", error));
}
