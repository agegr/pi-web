// Focused read-only sidebar fixture: E2E_BROWSER_CHANNEL=chrome node e2e/active-sidebar.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync, createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "test-results/e2e");
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-active-e2e-"));
const sessionsDir = join(agentDir, "sessions", "active-test");
const projects = [join(agentDir, "project-a"), join(agentDir, "project-b")];
for (const path of [artifacts, sessionsDir, ...projects]) mkdirSync(path, { recursive: true });
const timestamp = new Date().toISOString();
for (const [index, id] of ["active-a", "active-b"].entries()) {
  const cwd = projects[index];
  writeFileSync(join(sessionsDir, `${timestamp.replaceAll(":", "-")}_${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "message", id: "first", parentId: null, timestamp, message: { role: "user", content: `Active fixture ${id}` } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
const oldTimestamp = new Date(Date.now() - 2 * 3600_000).toISOString();
for (let i = 0; i < 90; i++) {
  const id = `old-${i}`;
  writeFileSync(join(sessionsDir, `${oldTimestamp.replaceAll(":", "-")}_${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp: oldTimestamp, cwd: projects[0] },
    { type: "message", id: "first", parentId: null, timestamp: oldTimestamp,
      message: { role: "user", content: `Older project-a session ${i}` } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const log = createWriteStream(join(artifacts, "active-server.log"));
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let browser;
try {
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok && (await response.json()).sessions.length === 92) break;
    assert.equal(server.exitCode, null, "Next exited; see active-server.log");
    assert.ok(i < 119, "Next fixture timed out; see active-server.log");
    await delay(500);
  }
  browser = await chromium.launch(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {});
  for (const width of [1280, 390, 320]) {
    const mobile = width <= 640;
    const height = width === 390 ? 844 : width === 320 ? 568 : 800;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: "en-US" });
    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${base}/?session=active-a`, { waitUntil: "domcontentloaded" });
      const openSidebar = async () => { if (mobile) await page.getByRole("button", { name: "Show sidebar" }).click(); };
      const activate = async (button) => mobile ? button.tap() : button.click();
      const waitForMode = (mode) => page.waitForFunction((expected) =>
        document.querySelector('#session-sidebar button[aria-pressed="true"]')?.textContent?.trim().startsWith(`${expected} `), mode);
      await openSidebar();
      const sidebar = page.locator("#session-sidebar");
      const projectsButton = sidebar.getByRole("button", { name: /^Project\s+\d+$/ });
      const activeButton = sidebar.getByRole("button", { name: /^Active\s+\d+$/ });
      await projectsButton.waitFor();
      const modeButtons = sidebar.getByRole("group", { name: "Session view" }).getByRole("button");
      assert.match(await modeButtons.nth(0).innerText(), /^Active\s+\d+$/, "Active leads the compact counted tabs");
      assert.match(await modeButtons.nth(1).innerText(), /^Project\s+\d+$/, "Project follows Active");
      assert.equal(await projectsButton.getAttribute("aria-pressed"), "true", "Projects is the default");
      await sidebar.getByText("Active fixture active-a", { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('#session-sidebar button[aria-pressed]')]
        .some((button) => button.textContent?.trim().replace(/\s+/g, " ") === "Project 91"));
      assert.equal((await modeButtons.nth(0).innerText()).replace(/\s+/g, " "), "Active 2");
      assert.equal(await sidebar.getByText("Active fixture active-b", { exact: true }).count(), 0, "Projects keeps the current workspace filter");
      if (!mobile) {
        const list = sidebar.locator(".scrollbar-subtle").filter({ hasText: "Active fixture active-a" });
        const original = await list.elementHandle();
        assert.ok(original);
        await list.hover();
        await page.mouse.wheel(0, 800);
        await page.waitForFunction((element) => element.scrollTop > 0, original);
        const scrollTop = await original.evaluate((element) => element.scrollTop);
        assert.ok(scrollTop > 0, "Projects list must actually scroll");
        await activate(activeButton);
        await waitForMode("Active");
        assert.equal(await original.evaluate((element) => element.getClientRects().length), 0, "Projects list must be hidden in Active");
        await activate(projectsButton);
        await waitForMode("Project");
        assert.equal(await original.evaluate((element) => element.isConnected), true, "Projects list must remain mounted");
        assert.equal(await original.evaluate((element) => element.scrollTop), scrollTop, "Projects scroll position must survive mode switching");
      }
      if (!mobile) {
        await activeButton.focus();
        await page.keyboard.press("Enter");
      } else await activate(activeButton);
      await sidebar.getByRole("region", { name: projects[0] }).waitFor();
      await sidebar.getByRole("region", { name: projects[1] }).waitFor();
      await sidebar.getByText("project-a", { exact: true }).waitFor();
      await sidebar.getByText("project-b", { exact: true }).waitFor();
      const row = sidebar.getByRole("button", { name: /Active fixture active-b/ });
      assert.match(await row.innerText(), /1 msgs/);
      assert.equal(await row.getByText("○", { exact: true }).count(), 1, "Active row has the local status indicator");
      assert.equal(await sidebar.getByRole("region", { name: projects[1] }).getByText("project-b").evaluate((element) => getComputedStyle(element.parentElement).position), "sticky");
      await sidebar.getByRole("button", { name: /Explorer.*project-a/i }).waitFor();
      const refreshBox = await sidebar.getByRole("button", { name: "Refresh explorer" }).boundingBox();
      const sidebarBox = await sidebar.boundingBox();
      assert.ok(refreshBox && sidebarBox && refreshBox.x + refreshBox.width <= sidebarBox.x + sidebarBox.width,
        `${width}px Explorer toolbar must remain inside the sidebar`);
      for (const control of [projectsButton, activeButton, row]) {
        const box = await control.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, `${width}px target too small`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}px horizontal overflow`);
      await page.screenshot({ path: join(artifacts, `active-${width}.png`) });
      if (mobile) await row.tap();
      else {
        await row.focus();
        await page.keyboard.press("Enter");
      }
      await page.waitForURL((url) => url.searchParams.get("session") === "active-b");
      await openSidebar();
      assert.equal(await activeButton.getAttribute("aria-pressed"), "true", "Active survives project switch");
      await activate(projectsButton);
      assert.equal(await projectsButton.getAttribute("aria-pressed"), "true");
      await sidebar.getByText("Active fixture active-b", { exact: true }).waitFor();
      assert.equal(await sidebar.getByText("Active fixture active-a", { exact: true }).count(), 0, "Projects follows the selected workspace");
      await page.reload();
      await openSidebar();
      await waitForMode("Project");
      await activate(activeButton);
      await page.reload();
      await openSidebar();
      await waitForMode("Active");
      assert.deepEqual(pageErrors, [], `${width}px browser errors`);
      console.log(`PASS: ${width}x${height} Chrome ${mobile ? "touch" : "desktop"}, cross-project jump, Projects and persistence; screenshot active-${width}.png`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  log.end();
  rmSync(agentDir, { recursive: true, force: true });
}
