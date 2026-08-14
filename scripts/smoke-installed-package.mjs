import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, isAbsolute, join, parse } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { smokeAllRoutes } from "./tanstack-route-smoke.mjs";

const tarballPath = process.argv[2] || "";
assert.ok(tarballPath && isAbsolute(tarballPath), "tarball path must be absolute");
assert.ok(tarballPath.endsWith(".tgz"), "tarball path must end in .tgz");
assert.ok(existsSync(tarballPath), `tarball missing: ${tarballPath}`);

const port = Number(process.env.PI_WEB_TANSTACK_SMOKE_PORT || 30147);
const origin = `http://127.0.0.1:${port}`;
const projectDir = mkdtempSync(join(tmpdir(), "pi-web-installed-"));
const installedBin = process.platform === "win32"
  ? join(projectDir, "node_modules", ".bin", "pi-web.cmd")
  : join(projectDir, "node_modules", ".bin", "pi-web");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDir,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      shell: options.shell ?? (command === npmExecutable && process.platform === "win32"),
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const npmInstall = await run(npmExecutable, ["init", "-y"], { stdio: "inherit" });
assert.equal(npmInstall.code, 0, "npm init failed");
const install = await run(npmExecutable, ["install", "--ignore-scripts", tarballPath], { stdio: "inherit" });
assert.equal(install.code, 0, `npm install failed: ${install.stderr}`);
assert.ok(existsSync(installedBin), `installed bin missing: ${installedBin}`);

// The publication tarball must not carry the traced dependency copy; the
// installed package resolves @earendil-works/* from the project's own
// node_modules (declared dependencies), which include runtime resources.
assert.ok(
  !existsSync(join(projectDir, "node_modules", "@agegr", "pi-web", ".output", "server", "node_modules")),
  "tarball must not ship the traced server/node_modules copy",
);
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  assert.ok(
    existsSync(join(projectDir, "node_modules", ...name.split("/"))),
    `${name} must resolve from installed dependencies`,
  );
}

const serverCommand = process.platform === "win32"
  ? (process.env.ComSpec || "cmd.exe")
  : process.execPath;
const serverArgs = process.platform === "win32"
  ? ["/c", installedBin, "--no-open", "-H", "127.0.0.1", "-p", String(port)]
  : [installedBin, "--no-open", "-H", "127.0.0.1", "-p", String(port)];
const server = spawn(serverCommand, serverArgs, {
  cwd: projectDir,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
  // Own process group so the CLI's own server child (spawned by pi-web.js)
  // dies with the wrapper instead of becoming an orphan that keeps the
  // smoke pipes open and prevents this script from exiting.
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    PI_WEB_HOSTNAME: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
  },
});
let serverLogs = "";
server.stdout.on("data", (chunk) => { serverLogs += chunk; });
server.stderr.on("data", (chunk) => { serverLogs += chunk; });

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${url}\n${serverLogs}`);
}

const installedPackageRoot = join(projectDir, "node_modules", "@agegr", "pi-web");
const installedRequire = createRequire(join(installedPackageRoot, "package.json"));
const stagedPkg = installedRequire("./package.json");
const resolveFromInstalled = (name) => import.meta.resolve(name, pathToFileURL(join(installedPackageRoot, "package.json")).href);

function packageJsonFor(resolveFrom, name) {
  let directory = dirname(fileURLToPathSafe(resolveFrom));
  const root = parse(directory).root;
  while (directory !== root) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === name) return pkg;
    }
    directory = dirname(directory);
  }
  throw new Error(`package.json not found for ${name}`);
}

function fileURLToPathSafe(value) {
  return value.startsWith("file://") ? fileURLToPath(value) : value;
}

const runtimeNames = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];
const versions = {};
for (const name of runtimeNames) {
  const resolvedPath = resolveFromInstalled(name);
  const pkg = packageJsonFor(resolvedPath, name);
  versions[name] = pkg.version;
  assert.ok(pkg.version, `${name} failed to resolve from the installed package`);
  assert.equal(
    pkg.version,
    (() => {
      const range = stagedPkg.dependencies[name];
      if (!range) throw new Error(`${name} must be a staged production dependency`);
      return range.startsWith("^") ? range.slice(1) : range;
    })(),
    `${name} resolved version must match the staged dependency range`,
  );
}
const lucidePkg = packageJsonFor(resolveFromInstalled("lucide-react"), "lucide-react");
assert.ok(lucidePkg.version, "lucide-react failed to resolve from the installed package");
assert.ok(stagedPkg.dependencies["lucide-react"], "lucide-react must be a staged production dependency");
versions["lucide-react"] = lucidePkg.version;

/** Send an HTTP request with an explicit Host header via node:http (fetch/undici sanitizes Host). */
function rawRequest(host, pathname) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers: { host } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  const root = await waitFor(`${origin}/`);
  assert.equal(root.status, 200);
  const rootHtml = await root.text();
  assert.match(rootHtml, /Pi Web/);
  assert.match(rootHtml, /codex-sidebar/, "installed root must render the real AppShell");

  const sessions = await fetch(`${origin}/api/sessions`);
  assert.equal(sessions.status, 200);
  assert.equal(sessions.headers.get("cache-control"), "no-store");
  const sessionsBody = await sessions.json();
  assert.ok(Array.isArray(sessionsBody.sessions));
  assert.ok(Array.isArray(sessionsBody.runningSessionIds));

  const manifest = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  const manifestBody = await manifest.json();
  assert.equal(manifestBody.name, "Pi Web");

  const sw = await fetch(`${origin}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get("service-worker-allowed"), "/");

  const untrustedRoot = await rawRequest("attacker.example", "/");
  assert.equal(untrustedRoot.status, 403);
  assert.equal(untrustedRoot.body, "Untrusted request");

  const untrustedApi = await rawRequest("attacker.example", "/api/sessions");
  assert.equal(untrustedApi.status, 403);
  assert.deepEqual(JSON.parse(untrustedApi.body), { error: "Untrusted API request" });

  // All 42 API routes with the identical safe probe matrix as standalone smoke.
  const routeSmoke = await smokeAllRoutes({ origin, authHeaders: {} });
  assert.ok(routeSmoke.results.length >= 41, "fewer than 41 route probes ran");

  console.log(JSON.stringify({
    projectDir,
    versions,
    root: root.status,
    sessions: sessions.status,
    manifest: manifest.status,
    sw: sw.status,
    security: "pass",
    routeProbes: routeSmoke.results.length,
    routeFailures: routeSmoke.results.filter((entry) => !entry.ok).length,
    skipped: routeSmoke.skipped,
  }));
} finally {
  if (process.platform !== "win32" && server.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* group already gone */ }
  }
  server.kill();
  // Close the pipe read ends so an orphaned grandchild holding the write ends
  // cannot keep this process's event loop alive.
  server.stdout?.destroy();
  server.stderr?.destroy();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) {
    if (process.platform !== "win32" && server.pid) {
      try { process.kill(-server.pid, "SIGKILL"); } catch { /* group already gone */ }
    }
    server.kill("SIGKILL");
  }
}
