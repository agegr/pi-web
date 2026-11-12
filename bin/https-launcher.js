"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const { randomUUID, X509Certificate } = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const { createHttp2Gateway } = require("./http2-gateway");
const { getNextNodeArgs } = require("./pi-web-node-args");
const { createRunRecordTracker, getOpenUrl, getRunDir } = require("./run-records");
const { openInBrowser } = require("./browser-opener");
const { formatReachableAddresses } = require("./network-addresses");
const { getSignalExitCode } = require("./process-lifecycle");
/* eslint-enable @typescript-eslint/no-require-imports */

function listen(server, port, hostname, signal) {
  return new Promise((resolve, reject) => {
    const failed = (error) => { server.removeListener("listening", ready); reject(error); };
    const ready = () => {
      server.removeListener("error", failed);
      if (signal?.aborted) { server.close(); reject(signal.reason); }
      else resolve();
    };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(port, hostname.startsWith("[") ? hostname.slice(1, -1) : hostname);
  });
}

// Discard the whole page body, following only same-instance redirects. This
// prewarms /login too, without TLS trust overrides, credentials, or an external
// fetch. Next derives request.url's scheme from our HTTPS forwarding header.
async function probeBackendPage(backendPort, publicUrl, signal) {
  const publicOrigin = new URL(publicUrl);
  let path = "/";
  for (let redirects = 0; redirects <= 10; redirects++) {
    const location = await new Promise((resolve, reject) => {
      const request = http.get({
        hostname: "127.0.0.1", port: backendPort, path, signal, agent: false,
        headers: { host: publicOrigin.host, "x-forwarded-host": publicOrigin.host, "x-forwarded-proto": "https" },
      }, (response) => {
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Private backend response aborted")));
        response.on("end", () => resolve(response.statusCode >= 300 && response.statusCode < 400 ? response.headers.location : null));
        response.resume();
      });
      request.on("error", reject);
    });
    if (!location) return;
    const target = new URL(location, publicOrigin);
    const privateTarget = target.hostname === "127.0.0.1" && target.port === String(backendPort)
      && ["http:", "https:"].includes(target.protocol);
    if (target.username || target.password || (!privateTarget && target.origin !== publicOrigin.origin)) return;
    path = `${target.pathname}${target.search}`;
  }
  throw new Error("Too many same-instance startup redirects");
}

// Production only. Keep Next's supported CLI, not a patched/private Next API.
// Reserve a random loopback port, then release it immediately before spawning
// Next. A race is a startup failure (Next must report Ready and serve a page),
// never permission to proxy to the competing listener or to fall back to HTTP.
async function startHttpsServer({ port, hostname, openBrowser, cert, key, nextBin, pkgDir, version }, {
  spawnImpl = spawn,
  parentProcess = process,
  runDir = getRunDir,
  open = openInBrowser,
  log = console.log,
  error = console.error,
  stdout = (text) => process.stdout.write(text),
  startupTimeoutMs = 60_000,
  shutdownTimeoutMs = 5_000,
  beforeSpawn = async () => {}, // dependency injection for the port-race test
} = {}) {
  const reservation = net.createServer();
  let gateway;
  let child;
  let tracker;
  let childClosed;
  let closed = false;
  let closing;
  let readyResolve;
  let readyReject;
  let startupText = "";
  let outputText = "";
  let forwardingReady = false;
  const startup = new AbortController();
  const timer = setTimeout(() => startup.abort(new Error("HTTPS startup timed out before Next.js served its first page")), startupTimeoutMs);
  const nextReady = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // A failure before spawn can occur before nextReady is awaited.
  nextReady.catch(() => {});
  const abortReady = () => readyReject(startup.signal.reason);
  startup.signal.addEventListener("abort", abortReady, { once: true });
  const signalHandlers = new Map();

  function close(signal = "SIGTERM") {
    if (closing) return closing;
    closed = true;
    forwardingReady = false;
    startup.abort(new Error("HTTPS startup/shutdown cancelled"));
    clearTimeout(timer);
    closing = (async () => {
      for (const [name, handler] of signalHandlers) parentProcess.removeListener(name, handler);
      if (reservation.listening) await new Promise((resolve) => reservation.close(resolve));
      const gatewayClosed = gateway?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const force = setTimeout(() => child.kill("SIGKILL"), shutdownTimeoutMs);
        force.unref();
        child.kill(signal);
        await childClosed;
        clearTimeout(force);
      }
      await gatewayClosed;
      tracker?.remove();
    })();
    return closing;
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      parentProcess.exitCode = getSignalExitCode(signal);
      void close(signal);
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  try {
    await listen(reservation, 0, "127.0.0.1", startup.signal);
    if (closed) throw startup.signal.reason;
    const backendPort = reservation.address().port;
    gateway = createHttp2Gateway({ backendPort, cert, key, isReady: () => forwardingReady });
    await listen(gateway.server, Number(port), hostname, startup.signal);
    if (closed) throw startup.signal.reason;
    const publicPort = gateway.server.address().port;
    const url = getOpenUrl(hostname, publicPort, "https");
    gateway.server.on("error", (failure) => {
      error(`[pi-web] HTTPS entry point failed (${failure.code || "server error"})`);
      parentProcess.exitCode = 1;
      void close();
    });
    await new Promise((resolve) => reservation.close(resolve));
    await beforeSpawn({ backendPort, publicPort, url });
    if (closed) throw startup.signal.reason;
    child = spawnImpl(process.execPath, getNextNodeArgs(nextBin, ["start", "-p", String(backendPort), "-H", "127.0.0.1"]), {
      cwd: pkgDir, stdio: ["inherit", "pipe", "inherit"],
      // PI_WEB_HOSTNAME is the PUBLIC host for the existing Host allow-list.
      // TLS buffers/files never enter the child's argv or environment.
      env: { ...process.env, PORT: String(backendPort), PI_WEB_HOSTNAME: hostname },
    });
    const writeOutput = (text) => stdout(text.replaceAll(`http://127.0.0.1:${backendPort}`, url).replaceAll(`https://127.0.0.1:${backendPort}`, url));
    childClosed = new Promise((resolve) => child.once("close", () => {
      if (outputText) writeOutput(outputText);
      resolve();
    }));
    child.on("error", (failure) => {
      readyReject(new Error(`Could not run the private Next.js backend (${failure.code || "spawn error"})`));
      if (!closed) { parentProcess.exitCode = 1; void close(); }
    });
    child.once("exit", (code, signal) => {
      readyReject(new Error(`Private Next.js backend exited before startup completed (${signal || code})`));
      if (!closed) {
        error(`[pi-web] Next.js exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`})`);
        parentProcess.exitCode = code || getSignalExitCode(signal);
        void close();
      }
    });
    child.stdout.on("data", (chunk) => {
      // Do not advertise Next's private HTTP port as a usable public URL.
      startupText = (startupText + chunk.toString()).slice(-8192);
      if (/\bReady\b/.test(startupText)) readyResolve();
      outputText += chunk.toString();
      const newline = outputText.lastIndexOf("\n");
      if (newline >= 0) { writeOutput(outputText.slice(0, newline + 1)); outputText = outputText.slice(newline + 1); }
      if (outputText.length > 8192) { writeOutput(outputText); outputText = ""; }
    });
    await nextReady;
    await probeBackendPage(backendPort, url, startup.signal);
    if (closed || child.exitCode !== null || child.signalCode !== null) throw new Error("Private Next.js backend stopped during startup");
    clearTimeout(timer);
    startup.signal.removeEventListener("abort", abortReady);
    const record = {
      pid: parentProcess.pid, nextPid: child.pid, port: publicPort, hostname, backendPort,
      scheme: "https", url, certFingerprint256: new X509Certificate(cert).fingerprint256,
      instanceId: randomUUID(), version, startedAt: new Date().toISOString(),
    };
    forwardingReady = true;
    tracker = createRunRecordTracker({ dir: runDir, record, parentProcess, warn: error });
    tracker.markReady();
    log(`Pi Web ready at ${url} (HTTPS; HTTP/2 with HTTP/1.1 fallback)`);
    const reachable = formatReachableAddresses(hostname, publicPort, { scheme: "https" });
    if (reachable) log(reachable);
    if (openBrowser) open(url); // The whole first page has already arrived.
    return { child, gateway, record, close };
  } catch (failure) {
    await close();
    throw failure;
  }
}

module.exports = { startHttpsServer, probeBackendPage };
