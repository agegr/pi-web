/**
 * Replaces the network layer before any Pi Web component runs: every
 * `/api/...` fetch and EventSource is answered in the page by the mock
 * backend, so the untouched UI behaves as if a Pi Web server were running.
 */
import { MockEventSource, setStreamResolver } from "./event-source";
import { handleApiRequest, resolveApiStream, warmDemoAssets } from "./router";
import { setRealFetch } from "./runtime";
import { WELCOME_SESSION_ID } from "./sessions/ids";
import { usageReport } from "./settings-routes";

declare global {
  interface Window {
    __piWebDemoInstalled?: boolean;
  }
}

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input, window.location.href);
  return new URL(input.url, window.location.href);
}

function isApiUrl(url: URL): boolean {
  return url.origin === window.location.origin && url.pathname.startsWith("/api/");
}

/**
 * First visit in this tab with a bare URL: open the welcome tour instead of an
 * empty composer. Pi Web restores `pi-web:tab-open-session` on load.
 */
function openWelcomeSessionOnFirstVisit(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("session") || params.has("cwd")) return;
    if (window.sessionStorage.getItem("pi-web:tab-open-session")) return;
    window.sessionStorage.setItem("pi-web:tab-open-session", JSON.stringify({ kind: "session", sessionId: WELCOME_SESSION_ID }));
  } catch {
    // Storage unavailable: Pi Web falls back to the most recent project.
  }
}

/** Show Codex quotas and the DeepSeek balance without a manual refresh. */
function seedProviderUsage(): void {
  for (const providerId of ["openai-codex", "deepseek"]) {
    try {
      const key = `pi-web:provider-usage:${providerId}`;
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(usageReport(providerId)));
    } catch {
      // Storage unavailable: the panel offers a manual refresh instead.
    }
  }
}

if (typeof window !== "undefined" && !window.__piWebDemoInstalled) {
  window.__piWebDemoInstalled = true;
  openWelcomeSessionOnFirstVisit();
  seedProviderUsage();
  const realFetch = window.fetch.bind(window);
  setRealFetch(realFetch);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);
    if (!isApiUrl(url)) return realFetch(input, init);
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? "GET";
    const body = init?.body ?? null;
    const signal = init?.signal ?? request?.signal ?? null;
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return handleApiRequest(url, method, body, signal, realFetch);
  };

  setStreamResolver(resolveApiStream);
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  warmDemoAssets();
}

export {};
