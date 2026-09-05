import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Run in a checkout without an active dev server");
const artifacts = mkdtempSync(join(tmpdir(), "pi-web-terminal-e2e-"));
console.log(`Artifacts: ${artifacts}`);
const agentDir = join(artifacts, "agent");
const workspace = join(artifacts, "workspace-a");
const otherWorkspace = join(artifacts, "workspace-b");
mkdirSync(join(agentDir, "sessions", "test"), { recursive: true });
mkdirSync(workspace);
mkdirSync(otherWorkspace);
writeFileSync(join(workspace, "note.txt"), "File viewer fixture\n");
const timestamp = "2026-09-05T00:00:00.000Z";
for (const [id, cwd, name] of [
  ["terminal-a1", workspace, "Terminal session one"],
  ["terminal-a2", workspace, "Terminal session two"],
  ["terminal-b1", otherWorkspace, "Other workspace session"],
]) {
  writeFileSync(join(agentDir, "sessions", "test", `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "session_info", id: "name", parentId: null, timestamp, name },
    { type: "message", id: "message", parentId: "name", timestamp, message: { role: "user", content: `${name} message` } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const log = createWriteStream(join(artifacts, "server.log"));
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1", HISTFILE: process.platform === "win32" ? "NUL" : "/dev/null", BASH_SILENCE_DEPRECATION_WARNING: "1", SHELL: process.platform === "win32" ? process.env.SHELL : "/bin/bash" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const serverExit = once(server, "exit");
let browser;
try {
  for (let i = 0; ; i++) {
    const response = await fetch(`${base}/api/sessions`).catch(() => null);
    if (response?.ok) break;
    assert.ok(i < 120 && server.exitCode === null, "Server did not become ready");
    await delay(500);
  }
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: "en-US" });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const created = new Set();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/terminal" && request.method() === "POST") created.add(request.postDataJSON().id);
    });
    const ready = () => page.locator(".terminal-panel:visible .is-ready").waitFor();
    const text = () => page.locator(".terminal-panel:visible .xterm-rows").innerText();
    const run = async (command) => {
      await page.locator(".terminal-panel:visible .xterm-helper-textarea").focus();
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    };
    const waitOutput = (pattern) => page.waitForFunction((source) => {
      const panel = [...document.querySelectorAll(".terminal-panel")].find((element) => element.getBoundingClientRect().width > 0);
      return new RegExp(source).test(panel?.querySelector(".xterm-rows")?.textContent ?? "");
    }, pattern);
    const showSidebar = async () => {
      const button = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await button.count()) await button.click();
    };
    const showPanel = () => page.getByRole("button", { name: "Show file panel", exact: true }).click();
    const hidePanel = async () => {
      const button = page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true, includeHidden: true });
      if (await button.getAttribute("aria-expanded") === "true") await button.click();
    };
    try {
      await page.goto(`${base}/?session=terminal-a1`);
      await page.getByText("Terminal session one message", { exact: true }).waitFor();
      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      await run("export PR695_TOKEN=alive; printf '\\nTOKEN:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput("TOKEN:alive:[0-9]+");
      const pid = (await text()).match(/TOKEN:alive:(\d+)/)[1];
      const [id] = created;
      assert.equal(created.size, 1);

      await hidePanel();
      await showSidebar();
      await page.getByText("note.txt", { exact: true }).click();
      await page.getByText("File viewer fixture", { exact: true }).waitFor();
      assert.equal(await page.locator(".terminal-panel").count(), 1);
      assert.equal(await page.locator(".terminal-panel").isVisible(), false);
      await page.getByRole("tab", { name: "Terminal: workspace-a", exact: true }).click();
      await ready();
      await hidePanel();
      await showSidebar();
      await page.getByText("Terminal session two", { exact: true }).click();
      await showPanel();
      await run("printf '\\nSESSION:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`SESSION:alive:${pid}`);

      await page.reload();
      await ready();
      await run("printf '\\nREFRESH:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`REFRESH:alive:${pid}`);
      assert.equal(created.size, 1, "refresh must reconnect, not create");

      await context.setOffline(true);
      await page.locator(".terminal-panel:visible .is-connecting").waitFor();
      await context.setOffline(false);
      await ready();
      await run("printf '\\nRECONNECT:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`RECONNECT:alive:${pid}`);
      assert.equal(((await text()).match(new RegExp(`REFRESH:alive:${pid}`, "g")) ?? []).length, 1, "reconnect must not replay delivered output");

      await page.screenshot({ path: join(artifacts, `${viewport.width}.png`), fullPage: true });
      const dimensions = await page.locator(".terminal-panel:visible").evaluate((element) => {
        const panel = element.getBoundingClientRect();
        const screen = element.querySelector(".xterm-screen").getBoundingClientRect();
        return { panelWidth: panel.width, screenWidth: screen.width, screenHeight: screen.height, fits: screen.right <= panel.right + 1 && screen.bottom <= panel.bottom + 1 };
      });
      assert.ok(dimensions.screenWidth > 100 && dimensions.screenHeight > 100 && dimensions.fits, JSON.stringify(dimensions));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

      await page.getByRole("button", { name: "Restart terminal", exact: true }).click();
      await page.waitForFunction((oldId) => {
        const saved = JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs"));
        return saved.tabs.length === 1 && saved.tabs[0].id !== oldId;
      }, id);
      await ready();
      assert.equal((await fetch(`${base}/api/terminal/${id}`)).status, 404);
      await run("exit 7");
      await page.getByText("Process exited with code 7", { exact: true }).waitFor();
      const currentId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).tabs[0].id);
      await page.getByRole("button", { name: "Terminate terminal workspace-a", exact: true }).click();
      await page.locator(".terminal-panel").waitFor({ state: "detached" });
      assert.equal((await fetch(`${base}/api/terminal/${currentId}`)).status, 404);

      let releaseCreation;
      const creationResponse = new Promise((resolve) => { releaseCreation = resolve; });
      await page.route("**/api/terminal", async (route) => {
        const response = await route.fetch();
        await creationResponse;
        await route.fulfill({ response });
      });
      await hidePanel();
      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await page.getByRole("button", { name: "Terminate terminal workspace-a", exact: true }).click();
      releaseCreation();
      await page.locator(".terminal-panel").waitFor({ state: "detached" });
      await page.unroute("**/api/terminal");
      for (const terminalId of created) assert.equal((await fetch(`${base}/api/terminal/${terminalId}`)).status, 404);

      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      await run("export PR695_WORKSPACE=retained");
      await hidePanel();
      await showSidebar();
      await page.getByRole("button").and(page.getByTitle(workspace, { exact: true })).first().click();
      await page.getByRole("button").and(page.getByTitle(otherWorkspace, { exact: true })).click();
      await page.getByText("Other workspace session", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      const workspaceTabs = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).tabs);
      assert.deepEqual(workspaceTabs.map((tab) => tab.cwd).sort(), [workspace, otherWorkspace].sort());
      const otherId = workspaceTabs.find((tab) => tab.cwd === otherWorkspace).id;
      assert.equal((await (await fetch(`${base}/api/terminal/${otherId}`)).json()).cwd, otherWorkspace);
      await page.getByRole("tab", { name: "Terminal: workspace-a", exact: true }).click();
      await run("printf '\\nWORKSPACE:%s\\n' \"$PR695_WORKSPACE\"");
      await waitOutput("WORKSPACE:retained");
      await page.screenshot({ path: join(artifacts, `${viewport.width}-workspaces.png`), fullPage: true });
      for (const name of ["workspace-a", "workspace-b"]) {
        await page.getByRole("button", { name: `Terminate terminal ${name}`, exact: true }).click();
      }
      await page.locator(".terminal-panel").waitFor({ state: "detached" });
      for (const terminalId of created) assert.equal((await fetch(`${base}/api/terminal/${terminalId}`)).status, 404);
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}: real shell, files, sessions, refresh, reconnect, restart, exit, close during creation, workspace isolation`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `failure-${viewport.width}.png`), fullPage: true });
      console.error(await page.locator("body").innerText());
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await serverExit;
  log.end();
}
