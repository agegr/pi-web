// E2E example for pi-web, script-style so it needs only `playwright` (already a
// devDependency) and no extra test runner. Starts nothing itself — point BASE at a
// running dev server (playwright.config-free: run `npm run dev` first, or let CI
// start it). Generates a 5000-message linear session under ~/.pi/agent/sessions
// so the app's own scan picks it up, opens it in a browser, and asserts the tail
// window + upward pagination work without crashing.
//
// CI wires this with: `npm run dev &` then `node e2e/run.mjs`.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const SESSION_ID = "e2e-ci-long-session-0001";
const N = 5000;

const sessionDir = join(homedir(), ".pi", "agent", "sessions", "e2e-ci");
const sessionFile = join(sessionDir, `2026-08-23T00-00-00-000Z_${SESSION_ID}.jsonl`);

function writeLongSession() {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: SESSION_ID, timestamp: new Date().toISOString(), cwd: process.cwd() }),
  ];
  for (let i = 0; i < N; i++) {
    lines.push(JSON.stringify({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `E2E message ${i}` },
    }));
  }
  writeFileSync(sessionFile, lines.join("\n") + "\n", "utf8");
}

// Ensure the session directory exists (fresh CI runners have no ~/.pi tree).
mkdirSync(sessionDir, { recursive: true });

const result = { passed: false, steps: [] };
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(30_000);
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  writeLongSession();
  result.steps.push("wrote 5000-message session");

  await page.goto(`${BASE}/?session=${SESSION_ID}`, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => (document.body.innerText || "").includes("E2E message 4990"), null, { timeout: 30_000 });
  result.steps.push("rendered tail (around message 4990)");

  const hasOldest = await page.evaluate(() => (document.body.innerText || "").includes("E2E message 0"));
  if (hasOldest) throw new Error("full 5000-message history was rendered instead of a tail window");
  result.steps.push("did not render the whole 5000-message forest");

  const hasLoadEarlier = await page.evaluate(() => /load earlier/i.test(document.body.innerText || ""));
  if (!hasLoadEarlier) throw new Error("'load earlier' sentinel missing for a truncated tail");
  result.steps.push("showed the 'load earlier' sentinel");

  result.pageErrors = pageErrors;
  result.consoleErrors = consoleErrors.filter((e) => !/favicon|404/i.test(e));
  if (result.pageErrors.length || result.consoleErrors.length) {
    throw new Error(`browser errors: page=${JSON.stringify(result.pageErrors)} console=${JSON.stringify(result.consoleErrors)}`);
  }
  result.passed = true;
} catch (e) {
  result.error = String(e);
} finally {
  result.steps.push("cleanup");
  try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.passed ? 0 : 1);
}
