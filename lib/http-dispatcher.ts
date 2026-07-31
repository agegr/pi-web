import { EventEmitter } from "node:events";
import type * as Undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;
type UndiciModule = typeof Undici;

type DispatcherGlobal = typeof globalThis & {
  __ompWebHttpDispatcherConfigured?: boolean;
  __ompWebHttpDispatcherConfiguring?: Promise<void>;
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
function withUndiciErrorListener<T extends Undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(
  undici: UndiciModule,
  origin: string | URL,
  options: object,
): Undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as Undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(
  undici: UndiciModule,
  origin: string | URL,
  options: object,
): Undici.Dispatcher {
  const dispatcherOptions = options as Undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(undici, origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: (factoryOrigin, factoryOptions) =>
        createUndiciClient(undici, factoryOrigin, factoryOptions),
    }),
  );
}

/**
 * Whether the process is running on Bun's runtime.
 *
 * Bun ships its own `undici` module: `setGlobalDispatcher` there does not affect
 * `fetch`, and `install` does not exist. Bun's native `fetch` already honors
 * `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` read at process start, so the
 * dispatcher dance is both ineffective and unnecessary under Bun — which is the
 * runtime `omp-web` actually serves on.
 */
export function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string";
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void | Promise<void> {
  if (dispatcherGlobal.__ompWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  if (isBunRuntime()) {
    dispatcherGlobal.__ompWebHttpDispatcherConfigured = true;
    return;
  }

  if (dispatcherGlobal.__ompWebHttpDispatcherConfiguring) {
    return dispatcherGlobal.__ompWebHttpDispatcherConfiguring;
  }

  const configuring = import("undici")
    .then((undici) => {
      const dispatcher = withUndiciErrorListener(
        new undici.EnvHttpProxyAgent({
          allowH2: false,
          bodyTimeout: normalizedTimeoutMs,
          headersTimeout: normalizedTimeoutMs,
          clientFactory: (origin, options) =>
            createUndiciClient(undici, origin, options),
          factory: (origin, options) =>
            createUndiciOriginDispatcher(undici, origin, options),
        }),
      );
      undici.setGlobalDispatcher(dispatcher);

      // Keep fetch and the dispatcher on the same undici implementation.
      // Preserve an intentional fetch override installed after module load.
      if (globalThis.fetch === originalGlobalFetch) {
        undici.install?.();
      }

      dispatcherGlobal.__ompWebHttpDispatcherConfigured = true;
    })
    .finally(() => {
      delete dispatcherGlobal.__ompWebHttpDispatcherConfiguring;
    });
  dispatcherGlobal.__ompWebHttpDispatcherConfiguring = configuring;
  return configuring;
}
