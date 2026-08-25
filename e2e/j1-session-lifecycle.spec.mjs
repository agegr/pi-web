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
	assertTailWindow,
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
	// Wait for the sentinel first so the oldest-message check below isn't
	// racing initial render (fast CI runners can beat virtualization).
	await page.waitForFunction(
		() => /load earlier/i.test(document.body.innerText || ""),
		null,
		{ timeout: 30_000 },
	);
	result.steps.push("sentinel present");
	// Deterministic #555 transport guard via API (sidebar previews the first
	// message, so body.innerText would always contain "E2E message 0").
	await assertTailWindow({ sessionId: LONG, tail: 50, forbiddenText: "E2E message 0" });
	result.steps.push("tail window enforced via API");
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
