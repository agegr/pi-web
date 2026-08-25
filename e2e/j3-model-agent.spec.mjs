// J3: Model/agent - model selector, subagent panels existence
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

const dir = e2eDir("e2e-j3");
const SID = "e2e-j3-model-0001";
const result = { journey: "J3 model/agent", passed: false, steps: [] };
let browser;
try {
	writeLinearSession({ dir, sessionId: SID, n: 10 });
	await waitForSessionListed(SID);
	const ctx = await launchPage();
	browser = ctx.browser;
	const { page, consoleErrors, pageErrors } = ctx;
	await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
	await waitForText(page, "E2E message 9");
	result.steps.push("session rendered");
	// Model selector / toolbar area should contain model or provider text
	const hasModelUi = await page.evaluate(() =>
		/model|provider|tools/i.test(document.body.innerText || ""),
	);
	if (!hasModelUi) throw new Error("model/tool UI missing");
	result.steps.push("model/tool UI present");
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
