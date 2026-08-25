// J0: Shell / Navigation - first open, sidebar, topbar (script-style, no runner)
import { BASE, e2eDir, writeLinearSession, cleanupDir, launchPage, waitForText, assertNoBrowserErrors, resultLog } from "./helpers.mjs";

const dir = e2eDir("e2e-j0");
const SID = "e2e-j0-nav-0001";
const result = { journey: "J0 shell/nav", passed: false, steps: [] };
let browser;
try {
  writeLinearSession({ dir, sessionId: SID, n: 20 });
  result.steps.push("session written");
  const ctx = await launchPage();
  browser = ctx.browser;
  const { page, consoleErrors, pageErrors } = ctx;
  await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
  // AppShell should render; sidebar should list the session (check title)
  await waitForText(page, "E2E message 19");
  result.steps.push("tail rendered");
  // Topbar theme toggle exists (aria-label/title contains theme)
  const hasTheme = await page.evaluate(() => /theme/i.test(document.body.innerHTML));
  if (!hasTheme) throw new Error("theme control missing");
  result.steps.push("theme control present");
  // Sidebar search / file explorer area present
  // Language toggle present (at least i18n exists)
  await assertNoBrowserErrors(consoleErrors, pageErrors);
  result.passed = true;
} catch (e) { result.error = String(e); }
finally { cleanupDir(dir); resultLog(result); if (browser) await browser.close(); process.exit(result.passed ? 0 : 1); }
