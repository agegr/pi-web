#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:30141",
    settleMs: 5_000,
    fileLabels: [],
    interactionSettleMs: 700,
    sessionSwitches: 0,
    historyPages: 0,
    rapidSessionSwitches: 0,
    explorerRefreshes: 0,
    explorerDirectories: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--url") {
      if (!value) throw new Error("--url requires a value");
      options.url = new URL(value).toString();
      index += 1;
    } else if (flag === "--settle-ms") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--settle-ms must be a non-negative integer");
      options.settleMs = parsed;
      index += 1;
    } else if (flag === "--file-label") {
      if (!value) throw new Error("--file-label requires a value");
      options.fileLabels.push(value);
      index += 1;
    } else if (flag === "--interaction-settle-ms") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--interaction-settle-ms must be a non-negative integer");
      options.interactionSettleMs = parsed;
      index += 1;
    } else if (flag === "--session-switches") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--session-switches must be a non-negative integer");
      options.sessionSwitches = parsed;
      index += 1;
    } else if (flag === "--history-pages") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--history-pages must be a non-negative integer");
      options.historyPages = parsed;
      index += 1;
    } else if (flag === "--rapid-session-switches") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--rapid-session-switches must be a non-negative integer");
      options.rapidSessionSwitches = parsed;
      index += 1;
    } else if (flag === "--explorer-refreshes") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--explorer-refreshes must be a non-negative integer");
      options.explorerRefreshes = parsed;
      index += 1;
    } else if (flag === "--explorer-directories") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--explorer-directories must be a non-negative integer");
      options.explorerDirectories = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

function waitForDebuggerUrl(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools")), timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      resolve(match[1]);
    };
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (${code ?? "signal"})`));
    });
  });
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.method !== message.method || waiter.sessionId !== message.sessionId) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message.params);
      }
      this.onEvent?.(message);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  waitFor(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        sessionId,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    this.socket.close();
  }
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

async function waitForPageCondition(client, sessionId, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    }, sessionId);
    if (result.result.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for a file interaction");
}

const SAFE_FILE_REQUEST_TYPES = new Set(["list", "read", "download", "meta", "preview", "watch", "directory-versions"]);

function sanitizeApiPath(pathname, fileRequestType) {
  if (pathname.startsWith("/api/files/")) {
    return `/api/files/[path]${fileRequestType ? `?type=${fileRequestType}` : ""}`;
  }
  if (/^\/api\/sessions\/[^/]+/.test(pathname)) {
    return pathname.replace(/^\/api\/sessions\/[^/]+/, "/api/sessions/[id]");
  }
  if (/^\/api\/agent\/(?!new(?:\/|$)|running(?:\/|$))[^/]+/.test(pathname)) {
    return pathname.replace(/^\/api\/agent\/[^/]+/, "/api/agent/[id]");
  }
  return pathname;
}

function summarizeRequests(requests, origin) {
  const api = new Map();
  let totalEncodedBytes = 0;
  for (const request of requests.values()) {
    if (!request.url.startsWith(origin) || !request.pathname.startsWith("/api/")) continue;
    const safePath = sanitizeApiPath(request.pathname, request.fileRequestType);
    const current = api.get(safePath) ?? {
      count: 0,
      forcedRefreshes: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
      encodedBytes: 0,
      statuses: new Set(),
    };
    current.count += 1;
    if (request.forceRefresh) current.forcedRefreshes += 1;
    if (request.finished) current.completed += 1;
    if (request.cancelled) current.cancelled += 1;
    if (request.failed) current.failed += 1;
    current.encodedBytes += request.encodedBytes ?? 0;
    if (request.status) current.statuses.add(request.status);
    api.set(safePath, current);
    totalEncodedBytes += request.encodedBytes ?? 0;
  }
  return {
    total: [...api.values()].reduce((sum, entry) => sum + entry.count, 0),
    totalEncodedBytes,
    byPath: Object.fromEntries([...api].sort(([a], [b]) => a.localeCompare(b)).map(([pathname, entry]) => [
      pathname,
      {
        count: entry.count,
        forcedRefreshes: entry.forcedRefreshes,
        completed: entry.completed,
        pending: entry.count - entry.completed - entry.cancelled - entry.failed,
        cancelled: entry.cancelled,
        failed: entry.failed,
        encodedBytes: entry.encodedBytes,
        statuses: [...entry.statuses].sort(),
      },
    ])),
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const targetUrl = new URL(options.url);
  const profileDirectory = await mkdtemp(join(tmpdir(), "pi-web-browser-baseline-"));
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let client;
  try {
    const debuggerUrl = await waitForDebuggerUrl(chrome);
    client = new CdpClient(debuggerUrl);
    await client.open();
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const requests = new Map();
    client.onEvent = (message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Network.requestWillBeSent") {
        const url = new URL(message.params.request.url);
        const requestedFileType = url.pathname.startsWith("/api/files/")
          ? url.searchParams.get("type")
          : null;
        requests.set(message.params.requestId, {
          url: url.origin + url.pathname,
          pathname: url.pathname,
          fileRequestType: requestedFileType && SAFE_FILE_REQUEST_TYPES.has(requestedFileType)
            ? requestedFileType
            : null,
          forceRefresh: url.searchParams.get("force") === "1"
            && ["/api/sessions", "/api/git/status", "/api/worktrees"].includes(url.pathname),
        });
      } else if (message.method === "Network.responseReceived") {
        const request = requests.get(message.params.requestId);
        if (request) request.status = message.params.response.status;
      } else if (message.method === "Network.loadingFinished") {
        const request = requests.get(message.params.requestId);
        if (request) {
          request.finished = true;
          request.encodedBytes = message.params.encodedDataLength;
        }
      } else if (message.method === "Network.loadingFailed") {
        const request = requests.get(message.params.requestId);
        if (request) {
          if (message.params.canceled) request.cancelled = true;
          else request.failed = true;
        }
      }
    };

    await Promise.all([
      client.send("Page.enable", {}, sessionId),
      client.send("Network.enable", {}, sessionId),
      client.send("Performance.enable", {}, sessionId),
      client.send("Runtime.enable", {}, sessionId),
    ]);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.__piWebBaselineLongTasks = [];
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              globalThis.__piWebBaselineLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {}
      `,
    }, sessionId);

    const loaded = client.waitFor("Page.loadEventFired", sessionId);
    await client.send("Page.navigate", { url: targetUrl.toString() }, sessionId);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, options.settleMs));

    const navigationApiRequests = summarizeRequests(requests, targetUrl.origin);
    let fileViewerInteractions = null;
    if (options.fileLabels.length > 0) {
      await waitForPageCondition(
        client,
        sessionId,
        `(() => {
          const labels = ${JSON.stringify(options.fileLabels)};
          const visibleLabels = new Set(
            [...document.querySelectorAll("span[title]")]
              .filter((element) => !element.closest("#file-panel"))
              .map((element) => element.textContent?.trim()),
          );
          return labels.every((label) => visibleLabels.has(label));
        })()`,
        60_000,
      );
      const sequence = options.fileLabels.length > 1
        ? [...options.fileLabels, options.fileLabels[0]]
        : options.fileLabels;
      const initialLongTasks = await client.send("Runtime.evaluate", {
        expression: "(globalThis.__piWebBaselineLongTasks ?? []).length",
        returnByValue: true,
      }, sessionId);
      const initialLongTaskCount = initialLongTasks.result.value ?? 0;
      const startedAt = Date.now();
      const interactionSteps = [];
      requests.clear();

      for (let index = 0; index < sequence.length; index += 1) {
        const stepStartedAt = Date.now();
        const clicked = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const label = ${JSON.stringify(sequence[index])};
            const target = [...document.querySelectorAll("span[title]")].find((element) => (
              !element.closest("#file-panel") && element.textContent?.trim() === label
            ));
            const fullPath = target?.getAttribute("title") ?? null;
            target?.parentElement?.click();
            return { clicked: Boolean(target), fullPath };
          })()`,
          returnByValue: true,
        }, sessionId);
        const clickResult = clicked.result.value;
        if (!clickResult?.clicked || !clickResult.fullPath) {
          throw new Error(`File interaction target #${index + 1} was not found`);
        }
        await waitForPageCondition(
          client,
          sessionId,
          `(() => {
            const fullPath = ${JSON.stringify(clickResult.fullPath)};
            return [...document.querySelectorAll("#file-panel .file-viewer-toolbar span[title]")]
              .some((element) => element.getAttribute("title") === fullPath);
          })()`,
        );
        interactionSteps.push({ index: index + 1, readyMs: Date.now() - stepStartedAt });
        await new Promise((resolve) => setTimeout(resolve, options.interactionSettleMs));
      }

      const interactionLongTasks = await client.send("Runtime.evaluate", {
        expression: `(() => (globalThis.__piWebBaselineLongTasks ?? [])
          .slice(${initialLongTaskCount})
          .map((entry) => entry.duration))()`,
        returnByValue: true,
      }, sessionId);
      const durations = interactionLongTasks.result.value ?? [];
      fileViewerInteractions = {
        stepCount: sequence.length,
        steps: interactionSteps,
        durationMs: Date.now() - startedAt,
        longTaskCount: durations.length,
        longTaskTotalMs: Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
        longTaskP95Ms: Number(percentile(durations, 0.95).toFixed(2)),
        apiRequests: summarizeRequests(requests, targetUrl.origin),
      };
    }

    let explorerRefreshInteractions = null;
    if (options.explorerRefreshes > 0) {
      await waitForPageCondition(
        client,
        sessionId,
        `document.querySelector('[data-action="refresh-file-explorer"]') !== null
          && document.querySelectorAll('[data-file-directory="true"]').length >= ${options.explorerDirectories}`,
        60_000,
      );
      for (let index = 0; index < options.explorerDirectories; index += 1) {
        const opened = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const target = document.querySelectorAll('[data-file-directory="true"]')[${index}];
            target?.click();
            return Boolean(target);
          })()`,
          returnByValue: true,
        }, sessionId);
        if (!opened.result.value) throw new Error(`Explorer directory #${index + 1} was not found`);
        await waitForPageCondition(
          client,
          sessionId,
          `document.querySelectorAll('[data-file-directory-open="true"]').length >= ${index + 1}`,
          30_000,
        );
      }
      const initialLongTasks = await client.send("Runtime.evaluate", {
        expression: "(globalThis.__piWebBaselineLongTasks ?? []).length",
        returnByValue: true,
      }, sessionId);
      const initialLongTaskCount = initialLongTasks.result.value ?? 0;
      const steps = [];
      const startedAt = Date.now();
      requests.clear();
      for (let index = 0; index < options.explorerRefreshes; index += 1) {
        const stepStartedAt = Date.now();
        const clicked = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const target = document.querySelector('[data-action="refresh-file-explorer"]');
            target?.click();
            return Boolean(target);
          })()`,
          returnByValue: true,
        }, sessionId);
        if (!clicked.result.value) throw new Error(`Explorer refresh #${index + 1} was not found`);
        await new Promise((resolve) => setTimeout(resolve, options.interactionSettleMs));
        steps.push({ index: index + 1, settleMs: Date.now() - stepStartedAt });
      }
      const interactionLongTasks = await client.send("Runtime.evaluate", {
        expression: `(() => (globalThis.__piWebBaselineLongTasks ?? [])
          .slice(${initialLongTaskCount})
          .map((entry) => entry.duration))()`,
        returnByValue: true,
      }, sessionId);
      const durations = interactionLongTasks.result.value ?? [];
      explorerRefreshInteractions = {
        stepCount: steps.length,
        expandedDirectoryCount: options.explorerDirectories,
        steps,
        durationMs: Date.now() - startedAt,
        longTaskCount: durations.length,
        longTaskTotalMs: Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
        longTaskP95Ms: Number(percentile(durations, 0.95).toFixed(2)),
        apiRequests: summarizeRequests(requests, targetUrl.origin),
      };
    }

    let sessionSwitchInteractions = null;
    if (options.sessionSwitches > 0) {
      await waitForPageCondition(
        client,
        sessionId,
        `document.querySelectorAll("[data-session-id]").length >= 2`,
        60_000,
      );
      await client.send("Runtime.evaluate", {
        expression: `globalThis.__piWebBaselineChatShell = document.querySelector("[data-ready-session-id]")`,
      }, sessionId);
      const initialLongTasks = await client.send("Runtime.evaluate", {
        expression: "(globalThis.__piWebBaselineLongTasks ?? []).length",
        returnByValue: true,
      }, sessionId);
      const initialLongTaskCount = initialLongTasks.result.value ?? 0;
      const interactionSteps = [];
      const startedAt = Date.now();
      requests.clear();

      for (let index = 0; index < options.sessionSwitches; index += 1) {
        const stepStartedAt = Date.now();
        const clicked = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const rows = [...document.querySelectorAll("[data-session-id]")];
            const target = rows[${index} % 2];
            const id = target?.getAttribute("data-session-id") ?? null;
            target?.click();
            globalThis.__piWebBaselineTargetSessionId = id;
            return Boolean(id);
          })()`,
          returnByValue: true,
        }, sessionId);
        if (!clicked.result.value) throw new Error(`Session interaction target #${index + 1} was not found`);
        await waitForPageCondition(
          client,
          sessionId,
          `(() => {
            const id = globalThis.__piWebBaselineTargetSessionId;
            return Boolean(id) && document.querySelector("[data-ready-session-id]")
              ?.getAttribute("data-ready-session-id") === id;
          })()`,
          60_000,
        );
        const shellIdentity = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const current = document.querySelector("[data-ready-session-id]");
            globalThis.__piWebBaselineChatShell ??= current;
            return Boolean(current) && globalThis.__piWebBaselineChatShell === current;
          })()`,
          returnByValue: true,
        }, sessionId);
        interactionSteps.push({
          index: index + 1,
          readyMs: Date.now() - stepStartedAt,
          shellPreserved: shellIdentity.result.value === true,
        });
        await new Promise((resolve) => setTimeout(resolve, options.interactionSettleMs));
      }

      const interactionLongTasks = await client.send("Runtime.evaluate", {
        expression: `(() => (globalThis.__piWebBaselineLongTasks ?? [])
          .slice(${initialLongTaskCount})
          .map((entry) => entry.duration))()`,
        returnByValue: true,
      }, sessionId);
      const durations = interactionLongTasks.result.value ?? [];
      sessionSwitchInteractions = {
        stepCount: interactionSteps.length,
        steps: interactionSteps,
        durationMs: Date.now() - startedAt,
        longTaskCount: durations.length,
        longTaskTotalMs: Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
        longTaskP95Ms: Number(percentile(durations, 0.95).toFixed(2)),
        apiRequests: summarizeRequests(requests, targetUrl.origin),
      };
    }

    let rapidSessionSwitchInteraction = null;
    if (options.rapidSessionSwitches > 0) {
      await waitForPageCondition(
        client,
        sessionId,
        `document.querySelectorAll("[data-session-id]").length >= 2`,
        60_000,
      );
      requests.clear();
      const startedAt = Date.now();
      for (let index = 0; index < options.rapidSessionSwitches; index += 1) {
        const clicked = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const rows = [...document.querySelectorAll("[data-session-id]")];
            const target = rows[${index} % 2];
            const id = target?.getAttribute("data-session-id") ?? null;
            target?.click();
            globalThis.__piWebBaselineRapidTargetSessionId = id;
            return Boolean(id);
          })()`,
          returnByValue: true,
        }, sessionId);
        if (!clicked.result.value) throw new Error(`Rapid session target #${index + 1} was not found`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await waitForPageCondition(
        client,
        sessionId,
        `(() => {
          const id = globalThis.__piWebBaselineRapidTargetSessionId;
          return Boolean(id) && document.querySelector("[data-ready-session-id]")
            ?.getAttribute("data-ready-session-id") === id;
        })()`,
        60_000,
      );
      await new Promise((resolve) => setTimeout(resolve, options.interactionSettleMs));
      rapidSessionSwitchInteraction = {
        stepCount: options.rapidSessionSwitches,
        finalTargetReady: true,
        durationMs: Date.now() - startedAt,
        apiRequests: summarizeRequests(requests, targetUrl.origin),
      };
    }

    let historyPageInteractions = null;
    if (options.historyPages > 0) {
      const steps = [];
      requests.clear();
      for (let index = 0; index < options.historyPages; index += 1) {
        const before = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const sentinel = document.querySelector("[data-history-sentinel]");
            const container = document.querySelector("[data-chat-scroll-container]");
            if (!sentinel || !container) return null;
            const count = Number(sentinel.getAttribute("data-earlier-count"));
            container.scrollTop = 0;
            return Number.isFinite(count) ? count : null;
          })()`,
          returnByValue: true,
        }, sessionId);
        const beforeCount = before.result.value;
        if (!Number.isFinite(beforeCount) || beforeCount <= 0) break;
        const startedAt = Date.now();
        await waitForPageCondition(
          client,
          sessionId,
          `(() => {
            const sentinel = document.querySelector("[data-history-sentinel]");
            if (!sentinel) return true;
            const count = Number(sentinel.getAttribute("data-earlier-count"));
            return Number.isFinite(count) && count < ${beforeCount};
          })()`,
          60_000,
        );
        const after = await client.send("Runtime.evaluate", {
          expression: `(() => {
            const value = document.querySelector("[data-history-sentinel]")
              ?.getAttribute("data-earlier-count");
            return value == null ? 0 : Number(value);
          })()`,
          returnByValue: true,
        }, sessionId);
        steps.push({
          index: index + 1,
          readyMs: Date.now() - startedAt,
          beforeCount,
          afterCount: after.result.value,
        });
      }
      historyPageInteractions = {
        stepCount: steps.length,
        steps,
        apiRequests: summarizeRequests(requests, targetUrl.origin),
      };
    }

    const evaluated = await client.send("Runtime.evaluate", {
      expression: `(() => ({
        navigation: performance.getEntriesByType("navigation").map((entry) => ({
          domContentLoaded: entry.domContentLoadedEventEnd,
          loadEventEnd: entry.loadEventEnd,
          responseEnd: entry.responseEnd,
          duration: entry.duration
        })),
        paints: performance.getEntriesByType("paint").map((entry) => ({ name: entry.name, startTime: entry.startTime })),
        longTasks: globalThis.__piWebBaselineLongTasks ?? []
      }))()`,
      returnByValue: true,
    }, sessionId);
    const performanceMetrics = await client.send("Performance.getMetrics", {}, sessionId);
    const page = evaluated.result.value;
    const longTaskDurations = page.longTasks.map((entry) => entry.duration);
    const metrics = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));

    console.log(JSON.stringify({
      schemaVersion: 1,
      targetOrigin: targetUrl.origin,
      settleMs: options.settleMs,
      navigation: page.navigation[0] ?? null,
      paints: page.paints,
      mainThread: {
        longTaskCount: longTaskDurations.length,
        longTaskTotalMs: Number(longTaskDurations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
        longTaskP95Ms: Number(percentile(longTaskDurations, 0.95).toFixed(2)),
        taskDurationMs: Number(((metrics.TaskDuration ?? 0) * 1000).toFixed(2)),
        jsHeapUsedBytes: metrics.JSHeapUsedSize ?? 0,
      },
      apiRequests: navigationApiRequests,
      fileViewerInteractions,
      explorerRefreshInteractions,
      sessionSwitchInteractions,
      historyPageInteractions,
      rapidSessionSwitchInteraction,
      note: "Dynamic API segments, file labels, target paths, query values, and page content are not recorded.",
    }, null, 2));
  } finally {
    client?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGTERM");
      await new Promise((resolve) => chrome.once("exit", resolve));
    }
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
