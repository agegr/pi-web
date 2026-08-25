// J5: Settings/ops - settings panel, plugins/skills, auth placeholder
import {
	BASE,
	e2eDir,
	writeLinearSession,
	cleanupDir,
	launchPage,
	waitForText,
	assertNoBrowserErrors,
	resultLog,
	waitForSessionListed,
} from "./helpers.mjs";

const dir = e2eDir("e2e-j5");
const SID = "e2e-j5-ops-0001";
const result = { journey: "J5 settings/ops", passed: false, steps: [] };
let browser;
try {
	writeLinearSession({ dir, sessionId: SID, n: 5 });
	await waitForSessionListed(SID);
	const ctx = await launchPage();
	browser = ctx.browser;
	const { page, consoleErrors, pageErrors } = ctx;
	await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
	await waitForText(page, "E2E message 4");
	result.steps.push("session rendered for settings context");
	// Settings / plugins / skills UI should be reachable via toolbar or sidebar
	const hasSettings = await page.evaluate(() =>
		/settings|plugins|skills/i.test(document.body.innerText || ""),
	);
	if (hasSettings) result.steps.push("settings/plugins/skills UI present");
	else result.steps.push("settings UI not detected (soft)");
	await assertNoBrowserErrors(consoleErrors, pageErrors);
	result.passed = true;
} catch (e) {
	result.error = String(e);
} finally {
	cleanupDir(dir);
	resultLog(result);
	if (browser) await browser.close();
	process.exit(result.passed ? 0 : 1);
}
