import { chromium } from "playwright";

const baseUrl = process.env.PI_WEB_BASE_URL ?? "http://127.0.0.1:30141";
const sessionId = process.env.PI_WEB_SESSION_ID;
const childSessionId = process.env.PI_WEB_CHILD_SESSION_ID;
const password = process.env.PI_WEB_PASSWORD;
const mode = process.env.PI_WEB_MODE ?? "root";
const settleMs = Number(process.env.PI_WEB_SETTLE_MS ?? 2_000);
const observeMs = Number(process.env.PI_WEB_OBSERVE_MS ?? 10_000);

if (!sessionId || !password || !["root", "child"].includes(mode)) {
  throw new Error("PI_WEB_SESSION_ID, PI_WEB_PASSWORD, and PI_WEB_MODE=root|child are required");
}
if (mode === "child" && !childSessionId) {
  throw new Error("PI_WEB_CHILD_SESSION_ID is required in child mode");
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: mode === "child" ? 1100 : 1280, height: 800 },
  serviceWorkers: "block",
  extraHTTPHeaders: {
    Authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`,
  },
});
const page = await context.newPage();
await page.addInitScript(() => {
  window.__piLongTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__piLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: true });
});

const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 50,
  downloadThroughput: 1_250_000,
  uploadThroughput: 625_000,
});

// CDP network events are unbuffered, unlike the 250-entry resource timing
// buffer that Vite's per-module requests exhaust in dev mode. Track every
// request here and derive session-list concurrency from it.
const networkRequests = [];
const networkPending = new Map();
cdp.on("Network.responseReceived", (event) => {
  const url = event.response?.url;
  if (!url || !url.startsWith(baseUrl)) return;
  const requestId = event.requestId;
  const now = performance.now();
  networkPending.set(requestId, {
    name: url,
    startTime: now,
    status: event.response.status,
    encodedBodySize: 0,
    duration: 0,
  });
});
cdp.on("Network.loadingFinished", (event) => {
  const pending = networkPending.get(event.requestId);
  if (!pending) return;
  networkPending.delete(event.requestId);
  pending.encodedBodySize = event.encodedDataLength ?? 0;
  pending.duration = performance.now() - pending.startTime;
  networkRequests.push(pending);
});

const targetId = mode === "child" ? childSessionId : sessionId;
const targetPath = `/api/sessions/${encodeURIComponent(targetId)}`;
const firstHistoryResponse = mode === "child"
  ? page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === targetPath && response.ok();
    }, { timeout: 120_000 })
  : null;

const startedAt = performance.now();
await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`, {
  waitUntil: "domcontentloaded",
  timeout: 120_000,
});

if (mode === "root") {
  const input = page.locator("textarea").last();
  await input.waitFor({ state: "visible", timeout: 120_000 });
  await input.focus();
  const originalValue = await input.inputValue();
  const probeValue = `${originalValue}pi readiness probe`;
  await input.fill(probeValue);
  if (await input.inputValue() !== probeValue) {
    throw new Error("Chat input is visible but not editable");
  }
  await input.fill(originalValue);
} else {
  const panelToggle = page.locator("[data-subagent-panel-toggle]").first();
  await panelToggle.waitFor({ state: "visible", timeout: 120_000 });
  await panelToggle.click();
  const childRow = page.locator(`[data-subagent-session-id="${childSessionId}"]`);
  await childRow.waitFor({ state: "visible", timeout: 120_000 });
  await childRow.click();
  await firstHistoryResponse;
  await page.waitForTimeout(settleMs);
}

const readyMs = performance.now() - startedAt;
const readyAt = await page.evaluate(() => performance.now());
if (mode === "root") await page.waitForTimeout(settleMs);

const { navigationResource, initialResources } = await page.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  return {
    navigationResource: navigation ? {
      name: navigation.name,
      startTime: navigation.startTime,
      encodedBodySize: navigation.encodedBodySize,
      duration: navigation.duration,
    } : null,
    initialResources: performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      encodedBodySize: entry.encodedBodySize,
      duration: entry.duration,
    })),
  };
});
await page.evaluate(() => performance.clearResourceTimings());
await page.waitForTimeout(observeMs);

const browserMetrics = await page.evaluate((browserReadyAt) => {
  const longTasks = window.__piLongTasks;
  return {
    longTasks,
    postReadyLongTasks: longTasks.filter((entry) => entry.startTime >= browserReadyAt),
    idleResources: performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      encodedBodySize: entry.encodedBodySize,
      duration: entry.duration,
    })),
    nodes: document.getElementsByTagName("*").length,
  };
}, readyAt);

const staticEncodedBytes = (navigationResource?.encodedBodySize ?? 0)
  + initialResources
    .filter(({ name }) => new URL(name).pathname.startsWith("/assets/"))
    .reduce((total, resource) => total + resource.encodedBodySize, 0);

// Derive request accounting from CDP network events (unbounded), split at the
// readiness timestamp. Resource timing remains only for static-byte sizing.
const initialNetworkRequests = networkRequests.filter((request) => request.startTime <= readyAt);
const idleNetworkRequests = networkRequests.filter((request) => request.startTime > readyAt);
const sessionListRequests = networkRequests
  .filter(({ name }) => new URL(name).pathname === "/api/sessions")
  .map(({ name, startTime, duration, status }) => ({ name, startTime, duration, status }));
const idleSessionRequests = idleNetworkRequests
  .filter(({ name }) => name.includes("/api/sessions/") && !name.includes("/state"))
  .map(({ name }) => ({ name }));
const sessionListEvents = sessionListRequests
  .flatMap(({ startTime, duration }) => [
    { at: startTime, delta: 1 },
    { at: startTime + duration, delta: -1 },
  ])
  .sort((left, right) => left.at - right.at || left.delta - right.delta);
let activeSessionListRequests = 0;
let maxConcurrentSessionListRequests = 0;
for (const event of sessionListEvents) {
  activeSessionListRequests += event.delta;
  maxConcurrentSessionListRequests = Math.max(maxConcurrentSessionListRequests, activeSessionListRequests);
}
console.log(JSON.stringify({
  mode,
  readyMs,
  navigationResource,
  staticEncodedBytes,
  initialResources,
  initialNetworkRequests: initialNetworkRequests.map(({ name, startTime }) => ({ name, startTime })),
  sessionListRequests,
  maxConcurrentSessionListRequests,
  idleSessionRequests,
  ...browserMetrics,
}, null, 2));
await browser.close();
