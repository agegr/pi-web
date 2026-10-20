import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { showSidebarSessions } from "./sidebar.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const attachedBase = process.env.PI_WEB_E2E_BASE;
assert.ok(attachedBase || !existsSync(join(root, ".next/dev/lock")), "Run without a dev server, or set PI_WEB_E2E_BASE to reuse it");
const artifacts = mkdtempSync(join(tmpdir(), "pi-web-project-dev-e2e-"));
console.log(`Artifacts: ${artifacts}`);
const agentDir = join(artifacts, "agent");
const workspace = join(artifacts, "dev-project");
const noConfig = join(artifacts, "plain-project");
mkdirSync(join(agentDir, "sessions", "test"), { recursive: true });
mkdirSync(workspace);
mkdirSync(noConfig);
const quote = (value) => process.platform === "win32" ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
const fixture = join(root, "lib/__fixtures__/project-dev-process.mjs");
const procfile = `web: ${quote(process.execPath)} ${quote(fixture)} parent\nworker: ${quote(process.execPath)} ${quote(fixture)} server worker-port.txt\n`;
writeFileSync(join(workspace, "Procfile.dev"), procfile);
for (const [index, cwd] of [workspace, noConfig].entries()) {
  const id = `dev-service-${index}`;
  const timestamp = "2026-09-05T00:00:00.000Z";
  writeFileSync(join(agentDir, "sessions", "test", `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "message", id: "msg", parentId: null, timestamp, message: { role: "user", content: `Fixture ${index}` } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = attachedBase || `http://127.0.0.1:${port}`;
const log = createWriteStream(join(artifacts, "server.log"));
const server = attachedBase ? null : spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server?.stdout.pipe(log, { end: false });
server?.stderr.pipe(log, { end: false });
let browser;
const reachable = (targetPort) => new Promise((resolve) => {
  const socket = connect({ port: targetPort, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => { socket.destroy(); resolve(false); });
});
const until = async (check) => {
  for (let index = 0; !await check(); index++) {
    assert.ok(index < 200, "condition timed out");
    await delay(100);
  }
};
try {
  for (let index = 0; ; index++) {
    const response = await fetch(`${base}/api/sessions`).catch(() => null);
    if (response?.ok) break;
    assert.ok(index < 120 && (!server || server.exitCode === null), "Server did not become ready");
    await delay(500);
  }
  const bindings = [];
  if (attachedBase) {
    for (const cwd of [workspace, noConfig]) {
      const response = await fetch(`${base}/api/cwd/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) });
      assert.ok(response.ok);
      bindings.push(await response.json());
    }
  }
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width < 768;
    const context = await browser.newContext({ viewport, locale: "en-US", hasTouch: mobile, isMobile: mobile });
    if (attachedBase) {
      // Keep fixture catalogue and sidebar preferences inside this browser:
      // attaching must never add sessions or pins to the user's server.
      const timestamp = new Date().toISOString();
      const sessions = bindings.map((binding, index) => ({
        id: `dev-service-${index}`, path: join(agentDir, `fixture-${index}.jsonl`),
        cwd: binding.cwd, projectRoot: binding.projectRoot, projectKey: binding.projectKey,
        created: timestamp, modified: timestamp, firstMessage: `Fixture ${index}`, messageCount: 1,
      }));
      await context.route((url) => url.pathname === "/api/sessions", (route) => route.fulfill({ json: { sessions, version: 1 } }));
      const state = { version: 1, revision: 0, sessions: {}, projects: {}, projectOrder: bindings.map((item) => item.projectKey) };
      await context.route((url) => url.pathname === "/api/sessions/ui-state", (route) => route.fulfill({ json: { state } }));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const errors = [];
    const controlRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/api/project-dev" || request.method() !== "POST") return;
      const body = request.postDataJSON();
      if (body.action !== "inspect") controlRequests.push(body);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const group = page.locator(".session-tree-group").filter({ has: page.locator(`.session-tree-group-toggle[title=${JSON.stringify(workspace)}]`) });
    const showSessions = async () => {
      const hidePanel = page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true });
      if (mobile && await hidePanel.isVisible()) await hidePanel.click();
      await page.locator(".new-session-hero").waitFor();
      await page.waitForFunction((expected) => {
        const current = JSON.parse(sessionStorage.getItem("pi-web:tab-open-session") || "null");
        return current?.kind === "new" && current.cwd === expected;
      }, workspace);
      if (viewport.width < 768) await page.locator(".session-tree.is-mobile").first().waitFor();
      const show = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await show.isVisible()) await show.click();
      await page.locator(".sidebar-container.sidebar-open").waitFor();
      await showSidebarSessions(page);
    };
    const openMenu = async () => {
      await showSessions();
      await group.hover();
      await group.getByRole("button", { name: "dev-project actions", exact: true }).click();
    };
    const services = page.getByRole("menu", { name: "Development services", exact: true });
    const openServices = async () => {
      const controlsBefore = controlRequests.length;
      if (!mobile) await page.mouse.move(700, 350);
      await showSessions();
      if (mobile) {
        await openMenu();
        await page.getByRole("menuitem", { name: "Development services", exact: true }).click();
      } else await group.getByRole("button", { name: /^(Start all|Stop all)$/, exact: true }).hover();
      await services.waitFor();
      if (!mobile) await services.hover();
      assert.equal(controlRequests.length, controlsBefore, "opening service statuses must never start or restart a service");
    };
    const request = async (action, cwd = workspace) => {
      const response = await context.request.post(`${base}/api/project-dev`, { data: { action, cwd, controlVersion: 2 } });
      assert.ok(response.ok(), await response.text());
      return response.json();
    };
    rmSync(join(workspace, "port.txt"), { force: true });
    rmSync(join(workspace, "worker-port.txt"), { force: true });
    await page.goto(`${base}/?cwd=${encodeURIComponent(workspace)}`);
    await showSessions();
    await group.getByRole("button", { name: "Start all", exact: true }).waitFor();
    const plain = page.locator(".session-tree-group").filter({ has: page.locator(`.session-tree-group-toggle[title=${JSON.stringify(noConfig)}]`) });
    assert.equal(await plain.locator(".project-dev-button").count(), 0);
    if (!mobile) {
      await page.locator("textarea.chat-input-textarea").focus();
      await group.getByRole("button", { name: "Start all", exact: true }).hover();
      await services.waitFor();
      assert.equal(await page.locator("textarea.chat-input-textarea").evaluate((element) => element === document.activeElement), true, "hover does not steal composer focus");
      await services.hover();
      await delay(400);
      assert.ok(await services.isVisible(), "moving from the button into the menu keeps it open");
      await page.mouse.move(700, 350);
      await services.waitFor({ state: "hidden" });
      await group.getByRole("button", { name: "Start all", exact: true }).focus();
      await page.keyboard.press("ArrowDown");
      await services.waitFor();
      assert.ok(await services.getByRole("menuitem").first().evaluate((element) => element === document.activeElement), "keyboard opening focuses the first action");
      await page.keyboard.press("Escape");
      await services.waitFor({ state: "hidden" });
      assert.equal(controlRequests.length, 0, "hover, entering the menu and keyboard opening execute no service commands");
    }
    const controlsBeforeToggle = controlRequests.length;
    await group.getByRole("button", { name: "Start all", exact: true }).click();
    await until(() => existsSync(join(workspace, "port.txt")) && existsSync(join(workspace, "worker-port.txt")));
    const allWebPort = Number(readFileSync(join(workspace, "port.txt"), "utf8"));
    const allWorkerPort = Number(readFileSync(join(workspace, "worker-port.txt"), "utf8"));
    assert.ok(await reachable(allWebPort));
    assert.ok(await reachable(allWorkerPort));
    await group.getByRole("button", { name: "Stop all", exact: true }).click();
    await until(async () => !await reachable(allWebPort) && !await reachable(allWorkerPort));
    await group.getByRole("button", { name: "Start all", exact: true }).waitFor();
    assert.deepEqual(controlRequests.slice(controlsBeforeToggle).map((item) => item.action), ["start", "stop"], "outer button toggles all services without restarting");
    rmSync(join(workspace, "port.txt"), { force: true });
    rmSync(join(workspace, "worker-port.txt"), { force: true });
    if (!mobile) {
      await page.mouse.move(700, 350);
      await services.waitFor({ state: "hidden" });
    }
    await openServices();
    const webRow = services.getByRole("group", { name: "web", exact: true });
    const workerRow = services.getByRole("group", { name: "worker", exact: true });
    await webRow.getByRole("menuitem", { name: "Start web", exact: true }).click();
    await until(() => existsSync(join(workspace, "port.txt")));
    const initialWebPort = Number(readFileSync(join(workspace, "port.txt"), "utf8"));
    assert.ok(await reachable(initialWebPort));
    assert.equal(await workerRow.locator(".project-dev-service-toggle").getAttribute("data-status"), "stopped");
    assert.equal(await webRow.getByRole("menuitem").count(), 2, "each row contains only a name and toggle icon");
    await workerRow.getByRole("menuitem", { name: "Start worker", exact: true }).click();
    await until(() => existsSync(join(workspace, "worker-port.txt")));
    const workerPort = Number(readFileSync(join(workspace, "worker-port.txt"), "utf8"));
    const before = await request("start");
    const legacy = await context.request.post(`${base}/api/project-dev`, { data: { cwd: workspace, action: "restart" } });
    assert.equal(legacy.status(), 409, "stale clients cannot execute their old one-click restart callbacks");
    assert.ok(await reachable(initialWebPort), "a stale restart leaves the running server untouched");
    const workerPid = before.processes.find((item) => item.name === "worker").pid;
    await webRow.getByRole("menuitem", { name: "Stop web", exact: true }).click();
    await until(async () => !await reachable(initialWebPort));
    await webRow.getByRole("menuitem", { name: "Start web", exact: true }).click();
    await until(() => Number(readFileSync(join(workspace, "port.txt"), "utf8")) !== initialWebPort);
    assert.equal(await reachable(initialWebPort), false);
    assert.ok(await reachable(workerPort));
    const after = await request("start");
    assert.equal(after.processes.find((item) => item.name === "worker").pid, workerPid, "toggling web preserves worker");
    await page.screenshot({ path: join(artifacts, `menu-${viewport.width}.png`) });
    await workerRow.getByRole("menuitem", { name: "View worker logs", exact: true }).click();
    const panel = page.getByRole("region", { name: "Development service", exact: true });
    await panel.waitFor();
    await panel.getByText(/listening:/).first().waitFor();
    assert.equal(await panel.getByRole("combobox", { name: "Process" }).inputValue(), "worker");
    assert.equal(await panel.locator(".project-dev-log-name").filter({ hasText: "[web]" }).count(), 0);
    await openServices();
    await webRow.getByRole("menuitem", { name: "View web logs", exact: true }).click();
    await until(async () => await panel.getByRole("combobox", { name: "Process" }).inputValue() === "web");
    await panel.getByText(/listening:/).first().waitFor();
    const firstPort = Number(readFileSync(join(workspace, "port.txt"), "utf8"));
    assert.ok(await reachable(firstPort));
    await Promise.all([request("start"), request("start")]);
    assert.equal(Number(readFileSync(join(workspace, "port.txt"), "utf8")), firstPort, "idempotent starts reuse the server");
    await panel.getByRole("combobox", { name: "Process" }).selectOption("");
    await page.screenshot({ path: join(artifacts, `running-${viewport.width}.png`) });

    await page.getByRole("tab", { name: /^Dev ·/ }).getByRole("button").click();
    assert.ok(await reachable(firstPort), "closing logs keeps the process alive");
    await page.reload();
    await openMenu();
    await page.getByRole("menuitem", { name: "View development logs", exact: true }).click();
    await panel.getByText(/listening:/).first().waitFor();
    assert.ok(await reachable(firstPort), "reload preserves the service");
    await panel.getByRole("button", { name: "Restart development service", exact: true }).click();
    await until(() => Number(readFileSync(join(workspace, "port.txt"), "utf8")) !== firstPort);
    const secondPort = Number(readFileSync(join(workspace, "port.txt"), "utf8"));
    assert.equal(await reachable(firstPort), false, "restart releases the old descendant's port");
    assert.ok(await reachable(secondPort));

    writeFileSync(join(workspace, "Procfile.dev"), "web:\n");
    const invalid = await context.request.post(`${base}/api/project-dev`, { data: { cwd: workspace, action: "restart", controlVersion: 2 } });
    assert.equal(invalid.status(), 400);
    assert.ok(await reachable(secondPort), "bad config preserves the old process");
    writeFileSync(join(workspace, "Procfile.dev"), procfile);
    await panel.getByRole("button", { name: "Stop development service", exact: true }).click();
    await panel.getByText("Procfile.dev · Stopped", { exact: true }).waitFor();
    assert.equal(await reachable(secondPort), false);
    const deniedCwd = join(artifacts, "outside");
    mkdirSync(deniedCwd, { recursive: true });
    const denied = await context.request.post(`${base}/api/project-dev`, { data: { action: "start", cwd: deniedCwd, controlVersion: 2 } });
    assert.equal(denied.status(), 403);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed ${viewport.width}px: service menu, independent controls, filtered logs, reload, restart, invalid config, stop, access denial`);
  }
} catch (error) {
  try {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/project-dev/events?cwd=${encodeURIComponent(workspace)}`, { signal: controller.signal });
    const first = await response.body.getReader().read();
    writeFileSync(join(artifacts, "service-events.txt"), new TextDecoder().decode(first.value));
    controller.abort();
  } catch { /* the server may already be gone */ }
  if (browser) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
    }
  }
  throw error;
} finally {
  await fetch(`${base}/api/project-dev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", cwd: workspace, controlVersion: 2 }) }).catch(() => {});
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  log.end();
  rmSync(agentDir, { recursive: true, force: true });
}
