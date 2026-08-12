import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { smokeAllRoutes } from "./tanstack-route-smoke.mjs";

const outputDir = (process.argv[2] || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
const serverEntry = join(outputDir, "server", "index.mjs");
assert.ok(existsSync(serverEntry), `server entry missing: ${serverEntry}`);

const port = Number(process.env.PI_WEB_TANSTACK_SMOKE_PORT || 30142);
const origin = `http://127.0.0.1:${port}`;
const password = process.env.PI_WEB_PASSWORD;
const authHeaders = password
  ? { authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}` }
  : {};
const child = spawn(process.execPath, [serverEntry], {
  cwd: outputDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    PI_WEB_HOSTNAME: "127.0.0.1",
  },
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { logs += chunk; process.stderr.write(chunk); });

async function waitFor(url, init) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${url}\n${logs}`);
}

/** Send an HTTP request with an explicit Host header via node:http (fetch/undici sanitizes Host). */
function rawRequest(host, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: pathname, method, headers: { host } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  const root = await waitFor(`${origin}/`, password ? { headers: authHeaders } : {});
  assert.match(await root.text(), /Pi Web/);
  const sessions = await fetch(`${origin}/api/sessions`, password ? { headers: authHeaders } : {});
  assert.equal(sessions.status, 200);
  assert.equal(sessions.headers.get("cache-control"), "no-store");
  const body = await sessions.json();
  assert.ok(Array.isArray(body.sessions));
  assert.ok(Array.isArray(body.runningSessionIds));

  // Untrusted host rejection matrix (node:http preserves the explicit Host header).
  const untrustedRoot = await rawRequest("attacker.example", "/");
  assert.equal(untrustedRoot.status, 403);
  assert.equal(untrustedRoot.body, "Untrusted request");

  const untrustedApi = await rawRequest("attacker.example", "/api/sessions");
  assert.equal(untrustedApi.status, 403);
  assert.deepEqual(JSON.parse(untrustedApi.body), { error: "Untrusted API request" });

  if (password) {
    const unauthenticated = await fetch(`${origin}/`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    assert.equal(
      unauthenticated.headers.get("www-authenticate"),
      'Basic realm="Pi Web", charset="UTF-8"',
    );
    assert.equal(await unauthenticated.text(), "Authentication required");
  }

  // Static PWA surface and cache headers.
  const rootHeaders = await fetch(`${origin}/`, password ? { headers: authHeaders } : {});
  assert.equal(rootHeaders.headers.get("cache-control"), "private, no-cache, max-age=0, must-revalidate");

  const sw = await fetch(`${origin}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("content-type") ?? "", /javascript/);
  assert.equal(sw.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(sw.headers.get("service-worker-allowed"), "/");

  const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const manifestBody = await manifestResponse.json();
  assert.equal(manifestBody.name, "Pi Web");

  const offline = await fetch(`${origin}/offline.html`);
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /Pi Web/);

  const icon = await fetch(`${origin}/icons/icon-192.png`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type") ?? "", /image\/png/);

  // All 41 API routes with safe probes (see tanstack-route-smoke.mjs).
  const routeSmoke = await smokeAllRoutes({ origin, authHeaders });
  assert.ok(routeSmoke.results.length >= 41, "fewer than 41 route probes ran");

  console.log(JSON.stringify({
    origin,
    sessions: body.sessions.length,
    password: Boolean(password),
    routeProbes: routeSmoke.results.length,
    routeFailures: routeSmoke.results.filter((entry) => !entry.ok).length,
    skipped: routeSmoke.skipped,
  }));
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
