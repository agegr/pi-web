// J6: API health / negative cases - any 5xx fails hard, so a change that
// breaks a route into a 500 is caught even when the UI still soft-renders.
import {
	BASE,
	e2eDir,
	writeLinearSession,
	cleanupDir,
	assertApiOk,
	assertApiNot500,
	resultLog,
} from "./helpers.mjs";

const dir = e2eDir("e2e-j6");
const SID = "e2e-j6-api-0001";
const result = { journey: "J6 api health", passed: false, steps: [] };
try {
	writeLinearSession({ dir, sessionId: SID, n: 10 });
	result.steps.push("session written");

	// 1. session detail must be 200 + JSON with expected shape
	const detail = await assertApiOk(`${BASE}/api/sessions/${SID}`);
	if (detail?.context?.messages?.length !== 10) {
		throw new Error(
			`detail context.messages.length=${detail?.context?.messages?.length}, want 10`,
		);
	}
	result.steps.push("detail 200 + shape ok");

	// 2. context endpoint must be 200 + JSON
	const ctxBody = await assertApiOk(
		`${BASE}/api/sessions/${SID}/context?tail=50`,
	);
	if (!Array.isArray(ctxBody?.messages)) {
		throw new Error("context response missing messages array");
	}
	result.steps.push("context 200 + messages array");

	// 3. sessions list must be 200
	await assertApiOk(`${BASE}/api/sessions`);
	result.steps.push("list 200");

	// 4. negative: invalid id -> not 500
	const badId = await assertApiNot500(
		`${BASE}/api/sessions/does-not-exist-9999`,
	);
	result.steps.push(`invalid id -> ${badId.status}`);

	// 5. negative: malformed leafId/tail -> not 500
	const badLeaf = await assertApiNot500(
		`${BASE}/api/sessions/${SID}/context?leafId=zzzz&tail=0`,
	);
	result.steps.push(`bad leafId/tail=0 -> ${badLeaf.status}`);

	// 6. negative: path traversal on files route -> not 500
	const traversal = await assertApiNot500(
		`${BASE}/api/files/..%2F..%2Fetc%2Fpasswd`,
	);
	result.steps.push(`path traversal -> ${traversal.status}`);

	result.passed = true;
} catch (e) {
	result.error = String(e);
} finally {
	cleanupDir(dir);
	resultLog(result);
	process.exit(result.passed ? 0 : 1);
}
