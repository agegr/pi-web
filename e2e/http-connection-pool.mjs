import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createHttp2Gateway } from "../bin/http2-gateway.js";

const OBSERVATION_MS = 800;
const REQUEST_TIMEOUT_MS = 5_000;
const HARD_TIMEOUT_MS = 90_000;
const MODES = ["http1", "https-http1", "https-http2"];

export async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createTestTls(directory, env) {
  const keyFile = join(directory, "test.key");
  const certFile = join(directory, "test.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile,
    "-out", certFile, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"],
  { env, stdio: "ignore", timeout: 10_000 });
  return { key: await readFile(keyFile), cert: await readFile(certFile) };
}

async function waitUntil(condition, label) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `${label}: timed out`);
    await delay(20);
  }
}

// HTTP/2 positive cases exercise the production gateway, with counters on a
// plain HTTP/1.1 synthetic backend. Negative controls have no gateway.
export async function startPoolFixture(mode, tls) {
  assert.ok(MODES.includes(mode), `Unknown transport: ${mode}`);
  if (mode === "https-http2") {
    const backend = await startPoolFixture("http1");
    let gateway;
    try {
      gateway = createHttp2Gateway({ backendPort: Number(new URL(backend.origin).port), ...tls });
      // Pure observation: Chromium may open more than one physical session.
      // Count completed TLS handshakes separately from logical request streams.
      const tlsConnections = new Set();
      const h2Sessions = new Set();
      const physical = { tlsConnections: { total: 0, peak: 0 }, h2Sessions: { total: 0, peak: 0 } };
      const observe = (event, active, counter) => gateway.server.on(event, (resource) => {
        active.add(resource);
        counter.total += 1;
        counter.peak = Math.max(counter.peak, active.size);
        resource.once("close", () => active.delete(resource));
      });
      observe("secureConnection", tlsConnections, physical.tlsConnections);
      observe("session", h2Sessions, physical.h2Sessions);
      await bounded(new Promise((resolve, reject) => {
        gateway.server.once("error", reject);
        gateway.server.listen(0, "127.0.0.1", resolve);
      }), 5_000, "gateway listen");
      return { ...backend, origin: `https://127.0.0.1:${gateway.server.address().port}`,
        backendOrigin: backend.origin, get streamCloses() { return backend.streamCloses; },
        get frontendPhysicalConnections() {
          return { tlsConnections: { ...physical.tlsConnections, active: tlsConnections.size },
            h2Sessions: { ...physical.h2Sessions, active: h2Sessions.size } };
        },
        async close() {
          try { await bounded(gateway.close(), 3_000, "gateway cleanup"); }
          finally { await backend.close(); }
        } };
    } catch (error) {
      try { await gateway?.close(); } finally { await backend.close(); }
      throw error;
    }
  }
  const streams = new Set();
  const streamSockets = new Map();
  const streamArrivals = [];
  const probes = new Map();
  const sockets = new Set();
  let streamCloses = 0;
  const transport = (request) => ({
    backendHttpVersion: request.httpVersion,
    backendAlpnProtocol: request.socket.alpnProtocol || null,
  });
  const handler = (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/events/")) {
      const id = url.pathname.slice("/events/".length);
      streamArrivals.push({ id, ...transport(request) });
      streamSockets.set(id, request.socket);
      streams.add(response);
      response.on("close", () => {
        streams.delete(response);
        streamCloses += 1;
      });
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.flushHeaders();
      response.write('data: {"ready":true}\n\n');
    } else if (url.pathname === "/probe") {
      const id = url.searchParams.get("id");
      assert.ok(!probes.has(id), `Duplicate probe: ${id}`);
      probes.set(id, { reachedServer: true, arrivedAtMs: performance.now(), method: request.method, ...transport(request),
        backendHost: request.headers.host, requestOrigin: request.headers.origin ?? null,
        forwardedProto: request.headers["x-forwarded-proto"] ?? null, fetchSite: request.headers["sec-fetch-site"] ?? null });
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const echo = request.method === "POST" ? JSON.parse(body).echo : undefined;
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: true, id, echo }));
      });
    } else if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end('<!doctype html><title>Synthetic connection pool</title><link rel="icon" href="data:,"><p>Local protocol control</p>');
    } else {
      response.writeHead(404);
      response.end();
    }
  };
  const server = mode === "http1" ? http.createServer(handler) : https.createServer(tls, handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  let closing;
  const close = () => closing ??= (async () => {
    const stopped = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const response of streams) response.destroy();
    for (const socket of sockets) socket.destroy();
    await bounded(stopped, 3_000, "fixture server cleanup");
  })();
  try {
    await bounded(new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    }), 5_000, "loopback listen");
    const origin = `${mode === "http1" ? "http" : "https"}://127.0.0.1:${server.address().port}`;
    return { origin, streams, streamSockets, streamArrivals, probes,
      emit(data) { for (const response of streams) response.write(`data: ${JSON.stringify(data)}\n\n`); },
      get streamCloses() { return streamCloses; }, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

export async function openEventStreams(page, ids) {
  return bounded(page.evaluate(async (ids) => {
    window.poolSources = ids.map((id) => new EventSource(`/events/${encodeURIComponent(id)}`));
    window.poolStreamErrors = 0;
    window.poolMessages = ids.map(() => []);
    await Promise.all(window.poolSources.map((source, index) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SSE ready message timed out")), 5_000);
      source.onerror = () => {
        window.poolStreamErrors += 1;
        clearTimeout(timer);
        reject(new Error("Synthetic SSE failed"));
      };
      source.onmessage = (event) => {
        window.poolMessages[index].push(JSON.parse(event.data));
        clearTimeout(timer);
        resolve();
      };
    })));
    return window.poolSources.filter((source) => source.readyState === EventSource.OPEN).length;
  }, ids), 6_000, "open SSE streams");
}

async function beginProbe(page, id, method = "GET") {
  await bounded(page.evaluate(({ id, method, timeoutMs }) => {
    const url = new URL(`/probe?id=${encodeURIComponent(id)}`, location.href).href;
    const controller = new AbortController();
    const started = performance.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    window.poolProbe = (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal, method,
          ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ echo: `echo-${id}` }) } : {}) });
        const body = await response.json();
        // ResourceTiming describes this completed fetch, not the configured server.
        const entry = performance.getEntriesByName(url).at(-1);
        return { completed: true, ok: response.ok && body.ok && body.id === id && (method !== "POST" || body.echo === `echo-${id}`),
          method, durationMs: performance.now() - started, nextHopProtocol: entry?.nextHopProtocol ?? null };
      } catch (error) {
        return { completed: false, error: String(error), timedOut: controller.signal.aborted,
          durationMs: performance.now() - started };
      } finally {
        clearTimeout(timer);
      }
    })();
  }, { id, method, timeoutMs: REQUEST_TIMEOUT_MS }), 2_000, "start browser fetch");
}

async function finishProbe(page) {
  return bounded(page.evaluate(() => window.poolProbe), REQUEST_TIMEOUT_MS + 1_000, "finish browser fetch");
}

function assertProbe(fixture, id, sample, expectedProtocol) {
  assert.equal(sample.completed, true, `${id}: ${JSON.stringify(sample)}`);
  assert.equal(sample.ok, true, id);
  assert.notEqual(sample.timedOut, true, `${id}: 5s queue timeout`);
  assert.equal(sample.nextHopProtocol, expectedProtocol, `${id}: actual fetch protocol`);
  const arrival = fixture.probes.get(id);
  assert.ok(arrival?.reachedServer, `${id}: request did not reach the server`);
  assert.equal(arrival.backendHttpVersion, "1.1", `${id}: actual backend protocol, independent of frontend ALPN`);
  assert.equal(arrival.method, sample.method);
  return { id, ...sample, ...arrival };
}

async function assertStreams(pages, fixture, count) {
  assert.equal(fixture.streams.size, count, "server's active logical SSE streams");
  assert.equal(fixture.streamArrivals.length, count, "no SSE reconnects/duplicates");
  assert.equal(fixture.streamCloses, 0, "all SSE responses remained open");
  const state = await bounded(Promise.all(pages.map((page) => page.evaluate(() => ({
    open: window.poolSources.filter((source) => source.readyState === EventSource.OPEN).length,
    errors: window.poolStreamErrors,
  })))), 2_000, "browser stream states");
  assert.equal(state.reduce((sum, item) => sum + item.open, 0), count);
  assert.equal(state.reduce((sum, item) => sum + item.errors, 0), 0);
}

async function checkSinglePage(context, fixture, mode) {
  const expectedProtocol = mode === "https-http2" ? "h2" : "http/1.1";
  const streamCount = mode === "https-http2" ? 12 : 6;
  const page = await context.newPage();
  await page.goto(fixture.origin, { timeout: 8_000 });
  const navigationProtocol = await page.evaluate(() => performance.getEntriesByType("navigation")[0].nextHopProtocol);
  assert.equal(navigationProtocol, expectedProtocol);
  await beginProbe(page, "warmup");
  assertProbe(fixture, "warmup", await finishProbe(page), expectedProtocol);
  assert.equal(await openEventStreams(page, Array.from({ length: streamCount }, (_, i) => `single-${i}`)), streamCount);
  await assertStreams([page], fixture, streamCount);

  await beginProbe(page, "held-streams");
  const observed = await bounded(page.evaluate(async (windowMs) => {
    let timer;
    const started = performance.now();
    try {
      const result = await Promise.race([
        window.poolProbe,
        new Promise((resolve) => { timer = setTimeout(() => resolve({ completed: false, pending: true }), windowMs); }),
      ]);
      return { ...result, observationElapsedMs: performance.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }, OBSERVATION_MS), 2_000, "800ms observation");
  const reachedServerDuringWindow = fixture.probes.has("held-streams");
  const result = { scenario: mode, productionGateway: mode === "https-http2", pages: 1, logicalStreams: streamCount, navigationProtocol,
    observationWindowMs: OBSERVATION_MS, observed, reachedServerDuringWindow,
    frontendPhysicalConnections: fixture.frontendPhysicalConnections,
    backendStreamProtocols: [...new Set(fixture.streamArrivals.map((arrival) => arrival.backendHttpVersion))] };
  // Print the actual observation even when an assertion below fails.
  console.log(JSON.stringify({ phase: "observation", ...result }));
  await assertStreams([page], fixture, streamCount);
  if (mode === "https-http2") {
    assert.equal(observed.completed, true, "HTTP/2 fetch completes with all twelve SSE streams held");
    assert.equal(reachedServerDuringWindow, true);
    result.probe = assertProbe(fixture, "held-streams", observed, expectedProtocol);
  } else {
    assert.equal(observed.pending, true, "HTTP/1.1 ordinary fetch is still queued, not failed");
    assert.ok(observed.observationElapsedMs >= OBSERVATION_MS - 20, "full short observation window");
    assert.equal(reachedServerDuringWindow, false, "queued request must not have reached the server");
    const released = await bounded(page.evaluate(async () => {
      const started = performance.now();
      window.poolSources[0].close();
      const sample = await window.poolProbe;
      return { ...sample, afterReleaseMs: performance.now() - started,
        remainingBrowserStreams: window.poolSources.filter((source) => source.readyState === EventSource.OPEN).length };
    }), REQUEST_TIMEOUT_MS + 1_000, "release one SSE stream");
    result.probe = assertProbe(fixture, "held-streams", released, expectedProtocol);
    assert.equal(released.remainingBrowserStreams, 5);
    assert.ok(released.afterReleaseMs < 2_000, "queued fetch recovers promptly after releasing one slot");
  }
  return result;
}

async function checkManyPages(context, fixture) {
  const pages = await Promise.all(Array.from({ length: 8 }, () => context.newPage()));
  const navigationProtocols = await Promise.all(pages.map(async (page, i) => {
    await page.goto(fixture.origin, { timeout: 8_000 });
    const protocol = await page.evaluate(() => performance.getEntriesByType("navigation")[0].nextHopProtocol);
    assert.equal(protocol, "h2");
    assert.equal(await openEventStreams(page, [`page-${i}-agent`, `page-${i}-terminal`]), 2);
    return protocol;
  }));
  await assertStreams(pages, fixture, 16);
  // Warm each page's short-fetch path with all sixteen SSE streams already held.
  for (let i = 0; i < pages.length; i += 1) {
    const id = `warmup-${i}`;
    await beginProbe(pages[i], id);
    assertProbe(fixture, id, await finishProbe(pages[i]), "h2");
  }
  const samples = [];
  for (let i = 0; i < 20; i += 1) {
    const pageIndex = i % pages.length;
    const id = `measured-${i}`;
    await beginProbe(pages[pageIndex], id, i % 2 ? "POST" : "GET");
    const sample = { pageIndex, ...assertProbe(fixture, id, await finishProbe(pages[pageIndex]), "h2") };
    samples.push(sample);
    console.log(JSON.stringify({ phase: "short-request", scenario: "https-http2-many-pages", ...sample }));
    await assertStreams(pages, fixture, 16);
  }
  const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  const latencyMs = { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) };
  const result = { scenario: "https-http2-many-pages", productionGateway: true, pages: pages.length, logicalStreams: 16,
    warmupRequests: 8, measuredRequests: samples.length, getRequests: 10, postRequests: 10, navigationProtocols,
    frontendPhysicalConnections: fixture.frontendPhysicalConnections,
    backendStreamProtocols: [...new Set(fixture.streamArrivals.map((arrival) => arrival.backendHttpVersion))],
    latencyMs, percentileMethod: "nearest-rank", allRequestsReachedServer: samples.every((sample) => sample.reachedServer),
    queueTimeouts: samples.filter((sample) => sample.timedOut).length, samples };
  console.log(JSON.stringify({ phase: "latency-summary", ...result }));
  assert.ok(latencyMs.p95 < 500, `local warm p95 must be <500ms: ${latencyMs.p95}`);
  assert.ok(latencyMs.max < 2_000, `local warm max must be <2000ms: ${latencyMs.max}`);
  assert.equal(result.queueTimeouts, 0, "no 5s queuing timeout");
  const cancelledSocket = fixture.streamSockets.get("page-0-agent");
  const pageSocket = fixture.streamSockets.get("page-0-terminal");
  await pages[0].evaluate(() => window.poolSources[0].close());
  await waitUntil(() => fixture.streams.size === 15 && cancelledSocket.destroyed, "cancelled stream releases backend socket");
  await checkEventDelivery(pages, fixture, "after-one-stream-cancel");
  await pages[0].close();
  await waitUntil(() => fixture.streams.size === 14 && pageSocket.destroyed, "closed page releases its backend sockets");
  await checkEventDelivery(pages.slice(1), fixture, "after-page-cancel");
  result.cancellation = { remainingStreams: 14, streamBackendSocketReleased: cancelledSocket.destroyed,
    pageBackendSocketReleased: pageSocket.destroyed, otherStreamsReceivedEvents: true };
  console.log(JSON.stringify({ phase: "cancellation", ...result.cancellation }));
  return result;
}

async function checkEventDelivery(pages, fixture, token) {
  fixture.emit({ token });
  await Promise.all(pages.map((page) => page.waitForFunction((token) => window.poolSources.every((source, i) =>
    source.readyState !== EventSource.OPEN || window.poolMessages[i].some((message) => message.token === token)), token, { timeout: 2_000 })));
  const state = await Promise.all(pages.map((page) => page.evaluate(() => ({
    open: window.poolSources.filter((source) => source.readyState === EventSource.OPEN).length,
    errors: window.poolStreamErrors,
  }))));
  assert.equal(state.reduce((sum, item) => sum + item.open, 0), fixture.streams.size, "other browser streams stay open");
  assert.equal(state.reduce((sum, item) => sum + item.errors, 0), 0, "no reconnect/error after cancellation");
  assert.ok(fixture.streamArrivals.every((arrival) => arrival.backendHttpVersion === "1.1"));
}

async function checkOriginForwarding(fixture, tls) {
  const client = http2.connect(fixture.origin, { ca: tls.cert, servername: "localhost" });
  client.on("error", () => {});
  try {
    const stream = client.request({ ":authority": new URL(fixture.origin).host,
      ":path": "/probe?id=origin-only", ":method": "POST",
      "content-type": "application/json", origin: fixture.origin });
    const status = await bounded(new Promise((resolve, reject) => {
      stream.on("response", (headers) => resolve(headers[":status"]));
      stream.on("error", reject);
      stream.resume();
      stream.end(JSON.stringify({ echo: "origin-only" }));
    }), 2_000, "trusted Node Origin-only fixture request");
    assert.equal(status, 200);
    const arrival = fixture.probes.get("origin-only");
    assert.equal(arrival.requestOrigin, fixture.origin);
    assert.equal(arrival.backendHost, new URL(fixture.origin).host);
    assert.equal(arrival.forwardedProto, "https");
    assert.equal(arrival.fetchSite, null);
    assert.equal(arrival.backendHttpVersion, "1.1");
    console.log(JSON.stringify({ phase: "origin-forwarding-control", status, frontendProtocol: client.socket.alpnProtocol,
      backendProtocol: arrival.backendHttpVersion, originScheme: new URL(arrival.requestOrigin).protocol,
      originHost: new URL(arrival.requestOrigin).host, backendHost: arrival.backendHost,
      forwardedProto: arrival.forwardedProto, fetchSite: arrival.fetchSite }));
  } finally {
    client.destroy();
  }
}

async function cleanupScenario(resource) {
  try {
    if (resource.context) {
      // Explicitly close EventSources before contexts; closing a context also
      // cancels a pending fetch/SSE setup if a test failed partway through.
      await bounded(Promise.all(resource.context.pages().map((page) => page.evaluate(() => {
        for (const source of window.poolSources ?? []) source.close();
      }).catch(() => {}))), 1_000, "close browser SSE streams").catch(() => {});
      await bounded(resource.context.close(), 3_000, "context cleanup");
    }
  } finally {
    await resource.fixture.close();
  }
}

async function main() {
  let directory;
  let browser;
  let active;
  let stopping = false;
  const results = [];
  // The normal deadline rejects into finally. A second watchdog bounds even
  // hung cleanup, removing the throwaway certificate without trusting it.
  const watchdog = setTimeout(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    console.error("FAIL: hard cleanup deadline exceeded");
    process.exit(1);
  }, HARD_TIMEOUT_MS + 15_000);
  try {
    await bounded((async () => {
      directory = await mkdtemp(join(tmpdir(), "pi-web-http-pool-"));
      const home = join(directory, "empty-home");
      await mkdir(home);
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home,
        TMPDIR: directory, XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache") };
      const tls = await createTestTls(directory, env);
      browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), env,
        args: ["--disable-background-networking", "--disable-component-update", "--no-proxy-server",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"], timeout: 15_000 });
      console.log(JSON.stringify({ phase: "start", browser: browser.version(), synthetic: true,
        productionGatewayValidated: true, nextApplicationValidated: false, hardTimeoutMs: HARD_TIMEOUT_MS,
        note: "Local encryption vs multiplexing mechanism acceptance, not a production performance guarantee." }));
      for (const scenario of [...MODES, "https-http2-many-pages"]) {
        if (stopping) throw new Error("Script deadline expired");
        const mode = scenario === "https-http2-many-pages" ? "https-http2" : scenario;
        active = { fixture: await startPoolFixture(mode, tls), context: null };
        try {
          // Never import the test certificate into OS trust or disable TLS
          // checks process-wide. Only these isolated test contexts ignore it.
          active.context = await browser.newContext({ ignoreHTTPSErrors: mode !== "http1", serviceWorkers: "block" });
          await active.context.route("**/*", (route) => {
            const origin = new URL(route.request().url()).origin;
            return origin === active.fixture.origin ? route.continue() : route.abort();
          });
          results.push(scenario === "https-http2-many-pages"
            ? await checkManyPages(active.context, active.fixture)
            : await checkSinglePage(active.context, active.fixture, mode));
          if (scenario === "https-http2") await checkOriginForwarding(active.fixture, tls);
        } finally {
          try { await cleanupScenario(active); }
          finally {
            if (active.fixture.frontendPhysicalConnections) console.log(JSON.stringify({
              phase: "frontend-physical-connections", scenario, includesNodeOriginControl: scenario === "https-http2",
              ...active.fixture.frontendPhysicalConnections,
            }));
            active = null;
          }
        }
      }
      console.log(JSON.stringify({ phase: "pass", scenarios: results.length, results }));
    })(), HARD_TIMEOUT_MS, "whole script");
  } finally {
    stopping = true;
    let scenarioCleaned = false;
    let browserClosed = false;
    try {
      if (active) await cleanupScenario(active);
      scenarioCleaned = true;
    } finally {
      try {
        if (browser) await bounded(browser.close(), 3_000, "browser cleanup");
        browserClosed = true;
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
        // A bounded close can reject while its underlying operation is still
        // hung. Keep the hard watchdog armed in that case, not just exitCode.
        if (scenarioCleaned && browserClosed) clearTimeout(watchdog);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("FAIL:", error);
    process.exitCode = 1;
  });
}
