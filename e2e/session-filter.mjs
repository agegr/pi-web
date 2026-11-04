// The session list's filter: a funnel in the sidebar's header narrows the rows
// by status (running / failed) and by the last activity's window, without
// hiding the selected chat or leaving empty project groups behind.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { showSidebarSessions } from "./sidebar.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Run in a checkout without an active dev server");
const artifacts = mkdtempSync(join(tmpdir(), "pi-web-filter-e2e-"));
console.log(`Artifacts: ${artifacts}`);
const agentDir = join(artifacts, "agent");
const sessionDir = join(agentDir, "sessions", "filter");
mkdirSync(sessionDir, { recursive: true });
const project = join(realpathSync(agentDir), "filter-project");
mkdirSync(project, { recursive: true });

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const names = { failed: "Failed run", done: "Finished run", oldFailed: "Old failure", oldDone: "Old run" };
for (const [id, label, modified, stopReason] of [
  ["filter-failed", names.failed, now, "error"],
  ["filter-done", names.done, now, "stop"],
  ["filter-old-failed", names.oldFailed, now - 20 * DAY, "error"],
  ["filter-old-done", names.oldDone, now - 20 * DAY, "stop"],
]) {
  const time = new Date(modified).toISOString();
  writeFileSync(join(sessionDir, `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp: time, cwd: project },
    { type: "session_info", id: `${id}-name`, parentId: null, timestamp: time, name: label },
    { type: "message", id: `${id}-user`, parentId: `${id}-name`, timestamp: time, message: { role: "user", content: `${label} request` } },
    {
      type: "message",
      id: `${id}-answer`,
      parentId: `${id}-user`,
      timestamp: time,
      message: { role: "assistant", content: [{ type: "text", text: `${label} answer` }], stopReason },
    },
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
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const serverExit = once(server, "exit");

/**
 * One pass over the funnel: the open chat is the old, finished one, so every
 * step also proves it stays listed whatever the filter says (the bar's hidden
 * count says how many the filter really removed).
 */
async function checkFilter(page, screenshotPrefix) {
  // Running comes from the sidebar's poll, not from this tab's chat.
  let runningIds = [];
  await page.route("**/api/agent/running*", (route) => route.fulfill({
    json: {
      sessionListVersion: 1,
      runningSessionIds: runningIds,
      awaitingInputSessionIds: [],
      subagentsActiveSessionIds: [],
      completionNotificationSuppressedSessionIds: [],
      sessionUiStateRevision: null,
    },
  }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/?session=filter-old-done`, { waitUntil: "domcontentloaded" });
  await showSidebarSessions(page);
  // A phone shows the sidebar as a drawer: it exists, and is off-screen, until
  // its opener is pressed (the button is mounted a moment after the page).
  const opener = page.getByRole("button", { name: "Show sidebar", exact: true });
  await opener.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await opener.isVisible().catch(() => false)) await opener.click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector(".session-sidebar");
    if (!sidebar) return false;
    const box = sidebar.getBoundingClientRect();
    return box.left >= -1 && box.right > 0;
  });

  const panel = page.locator("#session-sidebar-panel-sessions");
  const rows = panel.locator(".session-tree-session");
  const row = (name) => rows.filter({ has: page.locator(".session-tree-title", { hasText: new RegExp(`^${name}$`) }) });
  const visible = async () => (await rows.locator(".session-tree-title").allInnerTexts()).map((title) => title.trim()).sort();
  const sorted = (...labels) => [...labels].sort();
  for (const name of Object.values(names)) await row(name).first().waitFor();
  assert.deepEqual(await visible(), sorted(...Object.values(names)), "every session shows without a filter");

  const openMenu = async () => {
    await page.getByRole("button", { name: "Filter sessions", exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    return menu;
  };
  // Both groups are choices: a check mark holds the slot an icon would take.
  const pick = async (label) => {
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitemradio", { name: label, exact: true }).click();
  };
  const closeMenu = () => page.keyboard.press("Escape");
  const bar = panel.locator(".sidebar-filter-bar");

  // A failed reply is a status of its own; the menu stays open for the window.
  await openMenu();
  await pick("Failed");
  await row(names.failed).first().waitFor();
  assert.deepEqual(await visible(), sorted(names.failed, names.oldFailed, names.oldDone), "the selected chat stays listed");
  await page.screenshot({ path: join(artifacts, `${screenshotPrefix}-menu.png`) });
  await pick("Today");
  await closeMenu();
  await bar.waitFor();
  assert.match(await bar.innerText(), /Failed/);
  assert.match(await bar.innerText(), /2 hidden/);
  assert.deepEqual(await visible(), sorted(names.failed, names.oldDone));
  await page.screenshot({ path: join(artifacts, `${screenshotPrefix}-active.png`) });

  // The window is rolling: a 20-day-old failure leaves the last 7 days, and
  // comes back in the last 30.
  await openMenu();
  await pick("Last 7 days");
  await closeMenu();
  assert.deepEqual(await visible(), sorted(names.failed, names.oldDone));
  await openMenu();
  await pick("Last 30 days");
  await closeMenu();
  await row(names.oldFailed).first().waitFor();
  assert.deepEqual(await visible(), sorted(names.failed, names.oldFailed, names.oldDone));

  // Status "All" keeps the window: today's two runs only, plus the open chat.
  await openMenu();
  await pick("All");
  await pick("Today");
  await closeMenu();
  await row(names.done).first().waitFor();
  assert.deepEqual(await visible(), sorted(names.done, names.failed, names.oldDone));

  runningIds = ["filter-done"];
  await openMenu();
  await pick("Running");
  await closeMenu();
  await delay(2_600);
  await row(names.done).first().waitFor();
  assert.deepEqual(await visible(), sorted(names.done, names.oldDone));

  // Clearing brings every row back.
  runningIds = [];
  await bar.getByRole("button", { name: "Clear filter", exact: true }).click();
  await bar.waitFor({ state: "detached" });
  for (const name of Object.values(names)) await row(name).first().waitFor();
  assert.deepEqual(await visible(), sorted(...Object.values(names)));
  assert.deepEqual(errors, []);
}

let browser;
try {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${base}/api/sessions`).catch(() => null);
    if (response?.ok) break;
    assert.ok(attempt < 120 && server.exitCode === null, `Server did not become ready, see ${join(artifacts, "server.log")}`);
    await delay(500);
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  await checkFilter(await context.newPage(), "filter-desktop");
  await context.close();
  console.log("PASS: session filter by status and window, hidden count, running and clear (desktop)");

  // The header row is the tightest on a phone: the funnel must still fit and open there.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", isMobile: true, hasTouch: true });
  await checkFilter(await phone.newPage(), "filter-mobile");
  await phone.close();
  console.log("PASS: the same filter from a phone's header row");
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
  await Promise.race([serverExit, delay(10_000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
}
