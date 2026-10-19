// A standalone browser check of the sidebar's project filter: the unfiltered
// tree by default, Settings › General's filter row narrowing it to the project
// the file browser has picked, switching projects through that picker, and the
// filter surviving a reload.
//
// Run it on its own (it spawns its own dev server on a free port, with a
// generous first-compile budget):
//
//   node e2e/project-filter.mjs
//
// Not part of `npm run test:e2e`'s fixed checklist.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { showSidebarFiles } from "./sidebar.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// --- Fixtures: two projects, one session each; project-a is the most recent. ---

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-filter-"));
const projectA = join(agentDir, "project-a");
const projectB = join(agentDir, "project-b");
const sessionDir = join(agentDir, "sessions", "filter");
mkdirSync(projectA);
mkdirSync(projectB);
mkdirSync(sessionDir, { recursive: true });

function writeSession(id, cwd, text, mtime) {
  const header = { type: "session", version: 3, id, timestamp: "2026-08-23T00:00:00.000Z", cwd };
  const entry = { type: "message", id: `${id}-m1`, parentId: null, timestamp: "2026-08-23T00:00:01.000Z", message: { role: "user", content: text } };
  const path = join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`);
  writeFileSync(path, [header, entry].map((line) => JSON.stringify(line)).join("\n") + "\n");
  utimesSync(path, mtime, mtime);
}

writeSession("filter-a", projectA, "filter project a session", new Date("2026-08-24T00:00:00.000Z"));
writeSession("filter-b", projectB, "filter project b session", new Date("2026-08-23T00:00:00.000Z"));

// --- A dev server of this checkout on a free port. ---

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
server.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));
const serverExited = once(server, "exit");

let browser;
let page;

async function cleanup() {
  try { await browser?.close(); } catch {}
  server?.kill("SIGTERM");
  await Promise.race([serverExited, delay(5000)]).catch(() => server?.kill("SIGKILL"));
  rmSync(agentDir, { recursive: true, force: true });
}

process.on("uncaughtException", async (error) => {
  await cleanup();
  console.error(error);
  process.exit(1);
});

try {
  // Readiness: the first compile of /api/sessions can be slow on a cold cache.
  const deadline = Date.now() + 300_000;
  while (true) {
    assert.equal(server.exitCode, null, `Server exited before readiness:\n${serverLog.join("")}`);
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.deepEqual(sessions.map((session) => session.id).sort(), ["filter-a", "filter-b"]);
      break;
    }
    if (Date.now() > deadline) throw new Error(`Server not ready in 300s:\n${serverLog.join("")}`);
    await delay(1000);
  }

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  page = await context.newPage();
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (event) => { if (event.type() === "error") errors.push(`console: ${event.text()}`); });
  page.on("response", (response) => { if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });

  const groupNames = () => page.locator(".session-tree-group-name");
  const filesProjectButton = () => page.locator("#session-sidebar-panel-files .project-picker-button.is-project");
  /** The projects' menu rows: menuitemradio, named by the projects' paths. */
  const projectMenuChoice = (name) => page.getByRole("menuitemradio", { name });

  async function openGeneralSettings() {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".settings-section-tabs").getByRole("button", { name: "General", exact: true }).click();
  }

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  await showSidebar.or(page.locator(".session-tree-group-name")).first().waitFor();
  if (await showSidebar.isVisible()) await showSidebar.click();

  // Default: unfiltered, every project a group.
  await groupNames().first().waitFor();
  assert.equal(await groupNames().count(), 2, "unfiltered, the tree shows every project");
  console.log("PASS: the default tree is unfiltered");

  // Settings › General: the filter row switches live.
  await openGeneralSettings();
  const filterCurrent = page.getByRole("radio", { name: "Current only", exact: true });
  const filterShowAll = page.getByRole("radio", { name: "Show all", exact: true });
  await filterCurrent.waitFor();
  assert.equal(await filterShowAll.isChecked(), true, "showing every project is the default choice");
  await filterCurrent.locator("..").click();
  await page.keyboard.press("Escape");
  await groupNames().first().waitFor();
  assert.equal(await groupNames().count(), 1, "the filter leaves the picked project's group");
  assert.equal(await groupNames().getByText("project-a", { exact: true }).count(), 1, "the most recent project is the one shown");
  console.log("PASS: Settings › General filters the tree to a project");

  // The files' picker picks the project; the filtered tree follows it.
  await showSidebarFiles(page);
  await filesProjectButton().filter({ hasText: "project-a" }).waitFor();
  await filesProjectButton().click();
  await projectMenuChoice("/project-b").click();
  await groupNames().getByText("project-b", { exact: true }).waitFor();
  assert.equal(await groupNames().count(), 1, "still one group after the switch");
  assert.equal(await groupNames().getByText("project-a", { exact: true }).count(), 0, "the previous project's group is filtered out");
  console.log("PASS: the files' picker moves the filter to another project");

  // A filtered tree keeps its group open: a fold click is a no-op and saves nothing.
  const groupToggle = page.locator('[data-row-key^="group:"] .session-tree-group-toggle');
  await groupToggle.click();
  assert.equal(await groupToggle.getAttribute("aria-expanded"), "true", "the fold click does not collapse the filtered group");
  await page.getByText("filter project b session").waitFor();
  console.log("PASS: a fold click does not collapse the filtered group");

  // The filter survives a reload; the tree returns to the most recent project.
  await page.reload({ waitUntil: "domcontentloaded" });
  await groupNames().first().waitFor();
  assert.equal(await groupNames().count(), 1, "the saved filter survives a reload");
  assert.equal(await groupNames().getByText("project-a", { exact: true }).count(), 1, "back to the most recent project after reload");
  console.log("PASS: the saved filter survives a reload");

  // Settings reads the saved filter and switches it off again.
  await openGeneralSettings();
  await filterCurrent.waitFor();
  assert.equal(await filterCurrent.isChecked(), true, "Settings shows the saved filter (current only)");
  await filterShowAll.locator("..").click();
  await page.keyboard.press("Escape");
  await groupNames().filter({ hasText: "project-b" }).waitFor();
  assert.equal(await groupNames().count(), 2, "every project is back");
  console.log("PASS: Settings › General switches the filter off again");

  assert.deepEqual(errors, [], "no console or server errors along the way");
  console.log("PASS: no console or server errors");
} finally {
  await cleanup();
}
