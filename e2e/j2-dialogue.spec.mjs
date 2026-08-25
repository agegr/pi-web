// J2: Dialogue/execution - markdown, code block, tool call, written files (via rich session)
import { BASE, e2eDir, writeRichSession, cleanupDir, launchPage, waitForText, assertNoBrowserErrors, resultLog } from "./helpers.mjs";

const dir = e2eDir("e2e-j2");
const SID = "e2e-j2-rich-0001";
const result = { journey: "J2 dialogue/execution", passed: false, steps: [] };
let browser;
try {
  writeRichSession({ dir, sessionId: SID });
  result.steps.push("rich session written");
  const ctx = await launchPage();
  browser = ctx.browser;
  const { page, consoleErrors, pageErrors } = ctx;
  await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "hello");
  result.steps.push("markdown hello");
  await waitForText(page, "console.log");
  result.steps.push("code block");
  await waitForText(page, "tool test");
  result.steps.push("tool section");
  await assertNoBrowserErrors(consoleErrors, pageErrors);
  result.passed = true;
} catch (e) { result.error = String(e); }
finally { cleanupDir(dir); resultLog(result); if (browser) await browser.close(); process.exit(result.passed ? 0 : 1); }
