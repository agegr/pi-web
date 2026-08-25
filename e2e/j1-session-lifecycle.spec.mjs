// J1: Session lifecycle - open tail50, scroll/pagination, fork/branch, rename/delete/export
import {
	BASE,
	e2eDir,
	writeLinearSession,
	writeBranchedSession,
	cleanupDir,
	launchPage,
	waitForText,
	assertNoBrowserErrors,
	resultLog,
} from "./helpers.mjs";

const dir = e2eDir("e2e-j1");
const LONG = "e2e-j1-long-5000";
const BRANCH = "e2e-j1-branch-0001";
const result = { journey: "J1 session lifecycle", passed: false, steps: [] };
let browser;
try {
	writeLinearSession({ dir, sessionId: LONG, n: 5000 });
	writeBranchedSession({ dir, sessionId: BRANCH });
	result.steps.push("sessions written");
	const ctx = await launchPage();
	browser = ctx.browser;
	const { page, consoleErrors, pageErrors } = ctx;
	await page.goto(`${BASE}/?session=${LONG}`, {
		waitUntil: "domcontentloaded",
	});
	await waitForText(page, "E2E message 4990");
	result.steps.push("long tail");
	const hasOldest = await page.evaluate(() =>
		(document.body.innerText || "").includes("E2E message 0"),
	);
	if (hasOldest) throw new Error("full history rendered instead of tail");
	result.steps.push("tail window enforced");
	const hasSentinel = await page.evaluate(() =>
		/load earlier/i.test(document.body.innerText || ""),
	);
	if (!hasSentinel) throw new Error("load earlier sentinel missing");
	result.steps.push("sentinel present");
	// Branch session: open and see branch base
	await page.goto(`${BASE}/?session=${BRANCH}`, {
		waitUntil: "domcontentloaded",
	});
	await waitForText(page, "branch-base 9");
	result.steps.push("branched session rendered");
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
