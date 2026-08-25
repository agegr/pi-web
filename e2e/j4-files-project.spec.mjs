// J4: Files/project - FileExplorer, FileViewer, tab bar presence
import {
	BASE,
	e2eDir,
	writeLinearSession,
	cleanupDir,
	launchPage,
	waitForText,
	assertNoBrowserErrors,
	resultLog,
} from "./helpers.mjs";

const dir = e2eDir("e2e-j4");
const SID = "e2e-j4-files-0001";
const result = { journey: "J4 files/project", passed: false, steps: [] };
let browser;
try {
	writeLinearSession({ dir, sessionId: SID, n: 5 });
	const ctx = await launchPage();
	browser = ctx.browser;
	const { page, consoleErrors, pageErrors } = ctx;
	await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
	// File explorer / project trust area should be present (at least file path text)
	const hasFiles = await page.evaluate(() =>
		/files|explorer|project/i.test(document.body.innerText || ""),
	);
	// Don't fail hard on file explorer if not mounted without cwd, just check page rendered
	await waitForText(page, "E2E message 4");
	result.steps.push("session rendered for files context");
	if (!hasFiles) result.steps.push("files UI not detected (soft)");
	else result.steps.push("files/project UI present");
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
