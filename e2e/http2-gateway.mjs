import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import http2 from "node:http2";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
// Existing production build + candidate CLI only; never build or start Next dev.
import { bounded, createTestTls } from "./http-connection-pool.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const PASSWORD = "synthetic-gateway-password-not-a-real-secret";
const WORK_MS = 160_000;
const TOTAL_MS = 180_000;
const originDiagnostics = process.env.E2E_GATEWAY_DIAGNOSTICS === "origin";

async function until(condition, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `${label}: timed out`);
    await delay(20);
  }
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.notEqual(port, 30141);
  return port;
}

async function portClosed(port) {
  const socket = createConnection({ host: "127.0.0.1", port });
  try {
    return await bounded(new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(false));
      socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve(true) : reject(error));
    }), 1_000, "shutdown socket probe");
  } finally { socket.destroy(); }
}

async function main() {
  assert.equal(process.platform, "linux", "This process-group acceptance harness is Linux-only; Windows is untested");
  const packageDir = await realpath(resolve(process.env.E2E_GATEWAY_PACKAGE_DIR ?? root));
  assert.ok(existsSync(join(packageDir, ".next/BUILD_ID")),
    "E2E_GATEWAY_PACKAGE_DIR must contain an existing published/build artifact (.next/BUILD_ID); this script never builds");
  const binNames = (await readdir(join(root, "bin"))).filter((name) => name.endsWith(".js")).sort();
  const hashes = [];
  for (const name of binNames) {
    const hash = (data) => createHash("sha256").update(data).digest("hex");
    const candidate = hash(await readFile(join(root, "bin", name)));
    assert.equal(hash(await readFile(join(packageDir, "bin", name))), candidate, `Candidate bin hash mismatch: ${name}`);
    hashes.push({ file: `bin/${name}`, sha256: candidate });
  }
  let directory;
  let child;
  let childExit;
  let browserServer;
  let browser;
  let context;
  let client;
  let cliChild;
  let publicPort;
  let record;
  let runDir;
  let artifacts;
  let acceptanceComplete = false;
  let group = "node";
  let log;
  let cookie;
  let terminalId;
  let request;
  let stopping = false;
  const openRequests = new Set();
  const checks = [];
  const check = (name, actual, expected) => {
    const pass = actual === expected;
    const result = { group, name, pass, actual, expected };
    checks.push(result);
    console.log(JSON.stringify({ phase: "check", ...result }));
  };
  const killChild = (signal) => {
    // Signal our detached group even if the launcher already exited: Next
    // must not survive a startup failure or forced launcher shutdown.
    if (child?.pid) {
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  const killBrowser = () => {
    const pid = browserServer?.process().pid;
    if (pid) {
      try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  const watchdog = setTimeout(() => {
    killChild("SIGKILL");
    killBrowser();
    cliChild?.kill("SIGKILL");
    if (directory) rmSync(directory, { recursive: true, force: true });
    console.error("FAIL: 180s total deadline exceeded");
    process.exit(1);
  }, TOTAL_MS);
  try {
    await bounded((async () => {
      directory = await mkdtemp(join(tmpdir(), "pi-web-production-gateway-"));
      const home = join(directory, "home");
      const agentDir = join(home, "agent");
      const project = join(directory, "project");
      const sessionDir = join(agentDir, "sessions", "gateway");
      await mkdir(sessionDir, { recursive: true });
      await mkdir(project);
      const note = join(project, "note.txt");
      const outside = join(directory, "outside.txt");
      await writeFile(note, "Synthetic gateway file content\n");
      await writeFile(outside, "Synthetic forbidden content\n");
      const ids = ["gateway-agent-a", "gateway-agent-b"];
      const timestamp = "2026-09-05T00:00:00.000Z";
      for (const id of ids) {
        await writeFile(join(sessionDir, `${id}.jsonl`), [
          { type: "session", version: 3, id, timestamp, cwd: project },
          { type: "message", id: "entry", parentId: null, timestamp,
            message: { role: "user", content: "Synthetic stored message; never prompt a model" } },
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      }
      const shell = join(directory, "safe-shell");
      await writeFile(shell, '#!/bin/sh\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
      // Whitelist only the harness guard/cache inputs, never spread the real
      // parent environment, provider credentials, or personal user configs.
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, USERPROFILE: home,
        PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: PASSWORD, PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_WEB_SKIP_VERSION_CHECK: "1",
        NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
        PI_WEB_IDLE_TIMEOUT_MS: "0", SHELL: shell, HISTFILE: "/dev/null",
        XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), TMPDIR: directory,
        GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", NO_COLOR: "1",
        ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}) };
      const tls = await createTestTls(directory, env);
      artifacts = process.env.E2E_GATEWAY_ARTIFACTS ?? await mkdtemp(join(tmpdir(), "pi-web-production-gateway-log-"));
      await mkdir(artifacts, { recursive: true });
      await writeFile(join(artifacts, "candidate-hashes.json"), JSON.stringify({ packageDir, hashes }, null, 2) + "\n");
      log = createWriteStream(join(artifacts, "production-launcher.log"));
      publicPort = await availablePort();
      runDir = join(agentDir, "pi-web-run");
      child = spawn(process.execPath, [join(packageDir, "bin/pi-web.js"), "--port", String(publicPort),
        "--hostname", "127.0.0.1", "--https-cert", join(directory, "test.crt"),
        "--https-key", join(directory, "test.key"), "--no-open"],
        { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      childExit = once(child, "exit");
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      const origin = `https://127.0.0.1:${publicPort}`;
      const readyDeadline = Date.now() + 60_000;
      while (Date.now() < readyDeadline) {
        assert.equal(child.exitCode, null, "Production launcher exited during TLS readiness");
        assert.equal(child.signalCode, null, "Production launcher was signalled during TLS readiness");
        client = http2.connect(origin, { ca: tls.cert, servername: "localhost" });
        client.on("error", () => {});
        try {
          await bounded(once(client, "connect"), 2_000, "trusted synthetic TLS connect");
          break;
        } catch (error) {
          client.destroy();
          if (!["ECONNREFUSED", "ECONNRESET"].includes(error.code)) throw error;
          await delay(100);
        }
      }
      assert.ok(client && !client.destroyed, "Public HTTPS listener did not start within 60s");
      check("Node negotiated ALPN", client.socket.alpnProtocol, "h2");
      console.log(JSON.stringify({ phase: "start", nextMode: "start", launcherValidated: false,
        packageDir, candidateBinHashesVerified: hashes.length, publicOrigin: origin, artifacts,
        hardTimeoutMs: TOTAL_MS, modelPrompts: 0, fontCssMocked: false, fontRenderingValidated: false }));
      request = (path, { method = "GET", headers = {}, body, timeoutMs = 30_000, authenticated = true } = {}) => {
        // Node derives its default :authority from TLS servername; explicitly
        // use the URL's public authority so localhost SNI cannot alter Host.
        const stream = client.request({ ":authority": new URL(origin).host, ":path": path, ":method": method,
          ...(authenticated && cookie ? { cookie } : {}), ...headers });
        openRequests.add(stream);
        return bounded(new Promise((resolve, reject) => {
          let responseHeaders;
          let data = "";
          stream.on("response", (headers) => { responseHeaders = headers; });
          stream.setEncoding("utf8");
          stream.on("data", (chunk) => { data += chunk; });
          stream.on("error", reject);
          stream.on("end", () => resolve({ status: responseHeaders[":status"], headers: responseHeaders, body: data }));
          stream.end(body === undefined ? undefined : JSON.stringify(body));
        }), timeoutMs, `HTTP/2 ${method} ${path.split("?")[0]}`).finally(() => {
          openRequests.delete(stream);
          stream.close();
        });
      };
      const post = (path, body, { headers = {}, fetchMetadata = true, sendOrigin = true, ...extra } = {}) => request(path, {
        method: "POST", body, ...extra,
        headers: { "content-type": "application/json", ...(sendOrigin ? { origin } : {}),
          ...(fetchMetadata ? { "sec-fetch-site": "same-origin" } : {}), ...headers },
      });
      // The actual public launcher returns 503 until its bounded Next start
      // prewarm finishes. Any non-startup response is a real failure, not a retry.
      let unauthenticated;
      while (Date.now() < readyDeadline) {
        assert.equal(child.exitCode, null, "Production launcher exited during API readiness");
        unauthenticated = await request("/api/sessions", { authenticated: false, timeoutMs: 5_000 });
        if (unauthenticated.status === 401) break;
        assert.ok([502, 503].includes(unauthenticated.status), `Unexpected readiness status ${unauthenticated.status}`);
        await delay(100);
      }
      check("Unauthenticated API", unauthenticated?.status, 401);
      assert.equal(unauthenticated?.status, 401, "Public production API did not become ready within 60s");
      group = "launcher";
      const recordFile = join(runDir, `${child.pid}.json`);
      await until(() => existsSync(recordFile), 2_000, "production run record");
      record = JSON.parse(await readFile(recordFile, "utf8"));
      check("Run record launcher PID", record.pid, child.pid);
      check("Run record public HTTPS URL", record.url, origin);
      check("Run record public port", record.port, publicPort);
      check("Run record HTTPS scheme", record.scheme, "https");
      check("Run record private backend", Number.isInteger(record.backendPort) && record.backendPort !== publicPort && record.backendPort !== 30141, true);
      cliChild = spawn(process.execPath, [join(packageDir, "bin/pi-web.js"), "status"],
        { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
      let statusOutput = "";
      cliChild.stdout.on("data", (chunk) => { statusOutput += chunk; });
      cliChild.stderr.pipe(log, { end: false });
      const [statusCode] = await bounded(once(cliChild, "close"), 8_000, "production CLI status");
      check("CLI status exits successfully", statusCode, 0);
      check("CLI status advertises public HTTPS URL and port", statusOutput.includes(origin), true);
      check("CLI status does not advertise private backend", statusOutput.includes(`127.0.0.1:${record.backendPort}`), false);
      group = "node";
      const redirect = await request("/?fixture=gateway", { authenticated: false });
      check("Unauthenticated document redirect", [302, 307].includes(redirect.status), true);
      check("Unauthenticated redirect stays public", new URL(redirect.headers.location, origin).origin, origin);
      check("Unauthenticated redirect destination", new URL(redirect.headers.location, origin).pathname, "/login");
      const browserLikeLogin = await post("/api/web-auth", { password: PASSWORD }, { timeoutMs: 60_000 });
      check("Same-origin password login with Fetch Metadata", browserLikeLogin.status, 200);
      console.log(JSON.stringify({ phase: "login-diagnostic", untrustedApiResponse: /Untrusted API request/.test(browserLikeLogin.body) }));
      const login = browserLikeLogin;
      assert.equal(login.status, 200, "Actual same-origin login failed; no bootstrap bypass");
      const setCookie = login.headers["set-cookie"]?.[0];
      assert.ok(setCookie, "Login did not set a synthetic session cookie");
      cookie = setCookie.split(";", 1)[0]; // In memory only; never log the token.
      check("Session cookie Secure", /;\s*Secure(?:;|$)/i.test(setCookie), true);
      check("Session cookie HttpOnly", /;\s*HttpOnly(?:;|$)/i.test(setCookie), true);
      const sessions = await request("/api/sessions", { timeoutMs: 60_000 });
      check("Authenticated GET", sessions.status, 200);
      check("Only synthetic sessions", JSON.parse(sessions.body).sessions.length, 2);
      const fileUrl = (path) => `/api/files/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?type=read`;
      const file = await request(fileUrl(note), { timeoutMs: 60_000 });
      check("Normal file read", file.status, 200);
      check("File body survives forwarding", JSON.parse(file.body).content, "Synthetic gateway file content\n");
      check("Outside file rejected", (await request(fileUrl(outside))).status, 403);
      check("Encoded traversal rejected", (await request("/api/files/..%2F..%2Fsynthetic.txt?type=read")).status, 403);
      const uploadCheck = `/api/files/${project.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?type=upload-check`;
      check("Same-origin POST with Fetch Metadata", (await post(uploadCheck, { fileNames: ["new.txt"] },
        { headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" } })).status, 200);
      check("Safari-style POST Origin without Fetch Metadata", (await post(uploadCheck, { fileNames: ["new.txt"] }, { fetchMetadata: false })).status, 200);
      check("Malicious Origin rejected", (await request("/api/sessions", { headers: { origin: "https://malicious.invalid" } })).status, 403);
      check("Malicious Host rejected", (await request("/api/sessions", { headers: { ":authority": "malicious.invalid" } })).status, 403);
      if (originDiagnostics) {
        console.log(JSON.stringify({ phase: "origin-diagnostic-summary", checks: checks.length,
          failures: checks.filter((entry) => !entry.pass), nextMode: "start", launcherValidated: false }));
        assert.equal(checks.filter((entry) => !entry.pass).length, 0, "Origin forwarding/security checks failed");
        return;
      }
      const loggedInRedirect = await request("/login");
      check("Authenticated login redirect stays public", new URL(loggedInRedirect.headers.location, origin).origin, origin);

      const openSSE = async (path) => {
        const stream = client.request({ ":authority": new URL(origin).host, ":path": path, cookie });
        openRequests.add(stream);
        const events = [];
        let pending = "";
        let failure;
        stream.setEncoding("utf8");
        stream.on("error", (error) => { failure = error; });
        stream.on("data", (chunk) => {
          pending += chunk;
          let index;
          while ((index = pending.indexOf("\n\n")) !== -1) {
            const packet = pending.slice(0, index);
            pending = pending.slice(index + 2);
            for (const line of packet.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
          }
        });
        stream.end();
        const [headers] = await bounded(once(stream, "response"), 30_000, "SSE response");
        assert.equal(headers[":status"], 200, "Real Next SSE status");
        return { stream, events, async wait(predicate, label, milliseconds = 10_000) {
          await until(() => {
            if (failure) throw failure;
            const startupError = events.find((event) => event.type === "startup_error");
            if (startupError) throw new Error(startupError.errorMessage);
            return events.some(predicate);
          }, milliseconds, label);
          return events.find(predicate);
        } };
      };
      const agentStreams = [];
      for (const id of ids) {
        const state = await post(`/api/agent/${id}`, { type: "get_state", toolNames: [] }, { timeoutMs: 60_000, sendOrigin: false });
        check(`No-prompt agent open ${id}`, state.status, 200);
        const source = await openSSE(`/api/agent/${id}/events?holder=gateway-e2e`);
        agentStreams.push(source);
        await source.wait((event) => event.type === "connected", "agent connected snapshot");
      }
      check("Real Next agent SSE connected", agentStreams.length, 2);
      check("GET while agent SSE held", (await request("/api/sessions")).status, 200);
      for (const source of agentStreams) source.stream.close();
      const debug = await request("/api/agent/debug", { timeoutMs: 60_000 });
      check("Debug API after cancelling agent streams", debug.status, 200);
      let debugBody = JSON.parse(debug.body);
      const cancelDeadline = Date.now() + 3_000;
      while (debugBody.server.eventStreams.total !== 0 && Date.now() < cancelDeadline) {
        await delay(50);
        debugBody = JSON.parse((await request("/api/agent/debug")).body);
      }
      check("Cancelled real agent SSE released", debugBody.server.eventStreams.total, 0);

      terminalId = "0123456789abcdef0123456789abcdef";
      const terminal = await post("/api/terminal", { id: terminalId, cwd: project, cols: 80, rows: 24 }, { timeoutMs: 60_000, sendOrigin: false });
      if (terminal.status === 500 && /node-pty native terminal module|Cannot find module.*pty/i.test(terminal.body)) {
        console.log(JSON.stringify({ phase: "gap", feature: "PTY", reason: "node-pty native binary unavailable; no package installed" }));
        terminalId = undefined;
      } else {
        assert.equal(terminal.status, 200, "Real temporary PTY creation failed; see isolated Next log");
        const source = await openSSE(`/api/terminal/${terminalId}/events`);
        await post(`/api/terminal/${terminalId}`, { type: "input", data: "printf '\\nGATEWAY_%s\\n' 'PTY_ONE'\n" }, { sendOrigin: false });
        const output = await source.wait((event) => event.type === "output" && event.data.includes("GATEWAY_PTY_ONE"), "PTY echo");
        const offset = output.offset;
        check("PTY output offset positive", offset > 0, true);
        source.stream.close();
        const resumed = await openSSE(`/api/terminal/${terminalId}/events?after=${offset}`);
        await resumed.wait((event) => event.type === "output", "PTY resumed snapshot");
        check("PTY cursor does not replay delivered marker", resumed.events.some((event) => event.data?.includes("GATEWAY_PTY_ONE")), false);
        await post(`/api/terminal/${terminalId}`, { type: "input", data: "printf '\\nGATEWAY_%s\\n' 'PTY_TWO'\n" }, { sendOrigin: false });
        const next = await resumed.wait((event) => event.type === "output" && event.data.includes("GATEWAY_PTY_TWO"), "PTY resumed echo");
        check("PTY offset advances after reconnect", next.offset > offset, true);
        resumed.stream.close();
        check("Temporary PTY deleted", (await request(`/api/terminal/${terminalId}`, { method: "DELETE" })).status, 200);
        terminalId = undefined;
      }

      group = "browser";
      browserServer = await chromium.launchServer({ headless: true, executablePath: chromium.executablePath(),
        env: { PATH: env.PATH, HOME: home, XDG_CACHE_HOME: env.XDG_CACHE_HOME, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME },
        args: ["--disable-background-networking", "--disable-component-update", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"], timeout: 15_000 });
      if (stopping) { await browserServer.close(); throw new Error("Test deadline expired during browser launch"); }
      browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 5_000 });
      console.log(JSON.stringify({ phase: "browser", version: browser.version() }));
      context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
      await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const pageErrors = [];
      const consoleErrors = [];
      const assets = [];
      const redact = (message) => String(message).replaceAll(PASSWORD, "[synthetic-password]").replaceAll(cookie, "[synthetic-cookie]");
      page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(redact(message.text())); });
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith("/_next/")) assets.push({ origin: url.origin, path: url.pathname, status: response.status() });
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        assets.push({ origin: url.origin, path: url.pathname, failure: request.failure()?.errorText });
      });
      await page.addInitScript(() => {
        window.gatewayPageErrors = [];
        window.addEventListener("error", (event) => window.gatewayPageErrors.push(event.message));
        window.addEventListener("unhandledrejection", (event) => window.gatewayPageErrors.push(String(event.reason)));
      });
      try {
        const loginPage = await page.goto(`${origin}/login?next=%2Fapi%2Fsessions`, { timeout: 60_000, waitUntil: "domcontentloaded" });
        check("Browser login page renders", loginPage.status(), 200);
        assert.equal(loginPage.status(), 200, "Actual browser login page failed");
        // SSR visibility is not readiness: require loaded production scripts
        // and React's hydrated input props; fail immediately on real JS errors.
        await page.waitForFunction(() => {
          if (window.gatewayPageErrors.length) throw new Error(window.gatewayPageErrors.join("; "));
          const input = document.querySelector("#web-login-password");
          return document.readyState === "complete" && input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
        }, undefined, { timeout: 30_000 });
        await page.locator("#web-login-password").fill(PASSWORD);
        const [response] = await Promise.all([
          page.waitForResponse((response) => new URL(response.url()).pathname === "/api/web-auth" && response.request().method() === "POST", { timeout: 10_000 }),
          page.locator('button[type="submit"]').click(),
        ]);
        check("Browser password login", response.status(), 200);
        assert.equal(response.status(), 200, "Actual browser login failed; no injected cookie bypass");
        await page.waitForURL(`${origin}/api/sessions`, { timeout: 30_000 });
      } finally {
        console.log(JSON.stringify({ phase: "browser-diagnostics", pageErrors, consoleErrors, assets }));
      }
      check("Browser login destination stays public", new URL(page.url()).origin, origin);
      check("Browser actual navigation protocol", await page.evaluate(() => performance.getEntriesByType("navigation")[0].nextHopProtocol), "h2");
      const cookies = await context.cookies();
      const browserCookie = cookies.find((entry) => entry.name === cookie.split("=", 1)[0]);
      check("Browser cookie Secure and HttpOnly", browserCookie?.secure && browserCookie?.httpOnly, true);
      const browserApi = await page.evaluate(async (uploadCheck) => ({
        get: (await fetch("/api/web-auth")).status,
        post: (await fetch(uploadCheck, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileNames: ["browser-new.txt"] }) })).status,
      }), uploadCheck);
      check("Browser authenticated GET", browserApi.get, 200);
      check("Browser same-origin POST", browserApi.post, 200);
      check("Browser logout", await page.evaluate(async () => (await fetch("/api/web-auth", { method: "DELETE" })).status), 200);
      await page.goto(`${origin}/?fixture=logged-out`, { timeout: 30_000, waitUntil: "domcontentloaded" });
      check("Logout redirect stays public", new URL(page.url()).origin, origin);
      check("Logout redirects to login", new URL(page.url()).pathname, "/login");
      assert.equal(checks.filter((entry) => !entry.pass).length, 0, "Gateway/production Next acceptance failed; see check JSON lines");
      acceptanceComplete = true;
    })(), WORK_MS, "Production launcher gateway acceptance");
  } finally {
    stopping = true;
    let cleanupComplete = false;
    try {
      if (terminalId && request) await request(`/api/terminal/${terminalId}`, { method: "DELETE", timeoutMs: 2_000 }).catch(() => {});
      for (const stream of openRequests) stream.close();
      client?.destroy();
      const closed = await Promise.allSettled([
        bounded(context?.close() ?? Promise.resolve(), 2_000, "browser context cleanup"),
        bounded(browserServer?.close() ?? Promise.resolve(), 3_000, "browser process cleanup"),
      ]);
      killChild("SIGTERM");
      cliChild?.kill("SIGKILL");
      if (childExit) {
        await bounded(childExit, 5_000, "production launcher shutdown").catch(async () => {
          killChild("SIGKILL");
          await bounded(childExit, 1_000, "production launcher forced shutdown");
        });
      }
      group = "cleanup";
      if (child) {
        check("Launcher exited after shutdown", child.exitCode !== null || child.signalCode !== null, true);
        check("Public HTTPS socket released", await portClosed(publicPort), true);
      }
      if (record) {
        check("Private Next socket released", await portClosed(record.backendPort), true);
        await until(() => !existsSync(`/proc/${record.nextPid}`), 1_000, "private Next process exit");
        check("Private Next process exited", existsSync(`/proc/${record.nextPid}`), false);
        check("Launcher run record removed", existsSync(join(runDir, `${child.pid}.json`)), false);
      }
      check("Browser resources closed", closed.every((result) => result.status === "fulfilled"), true);
      assert.ok(closed.every((result) => result.status === "fulfilled"), "A browser cleanup operation timed out");
      cleanupComplete = true;
    } finally {
      killChild("SIGKILL");
      killBrowser();
      cliChild?.kill("SIGKILL");
      if (log) await new Promise((resolve) => log.end(resolve));
      if (directory) await rm(directory, { recursive: true, force: true });
      check("Temporary home and certificates removed", directory ? existsSync(directory) : false, false);
      const summary = { phase: "summary", checks: checks.length, failures: checks.filter((entry) => !entry.pass),
        groups: Object.fromEntries(["node", "launcher", "browser", "cleanup"].map((name) => [name, checks.filter((entry) => entry.group === name).length])),
        nextMode: "start", launcherValidated: acceptanceComplete && cleanupComplete && checks.every((entry) => entry.pass),
        originDiagnosticOnly: originDiagnostics, cleanupComplete, productionPerformanceGuaranteed: false };
      console.log(JSON.stringify(summary));
      if (artifacts) await writeFile(join(artifacts, "checks.json"), JSON.stringify({ ...summary, results: checks }, null, 2) + "\n");
      clearTimeout(watchdog);
      assert.equal(checks.filter((entry) => !entry.pass).length, 0, "Production gateway checks failed");
    }
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
