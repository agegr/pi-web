// Performance bench: quantifies real-world-shaped load on a pristine server.
// Runs in its own CI job (fresh dev server, no warmed caches).
//
// What it measures (all printed as JSON; gates are deliberately generous —
// they catch order-of-magnitude regressions, not runner noise):
//   coldListMs    — first GET /api/sessions with PERF_SESSIONS fixture sessions
//                   on disk (includes dev-route compile; simulates the
//                   many-sessions cold scan users feel, cf. #555)
//   warmListMs    — second GET /api/sessions (cache-hit path)
//   detailMs      — GET /api/sessions/<big>/detail-equivalent (tail=50) on a
//                   5000-message session
//   pageRenderMs  — browser goto -> 'load earlier' sentinel visible for the
//                   5000-message session (#509/#555 UI path)
//
// Honest caveat: numbers are dev-server figures on shared CI runners. They are
// for trend/regression detection, not absolute user-perceived latency.
import {
	BASE,
	e2eDir,
	writeLinearSession,
	cleanupDir,
	launchPage,
	assertTailWindow,
	resultLog,
} from "./helpers.mjs";

const PERF_SESSIONS = Number(process.env.PERF_SESSIONS || 200);
const BIG_ID = "e2e-perf-big-5000";
const GATES = {
	contextMsMax: Number(process.env.GATE_CONTEXT_MS || 5000),
	warmListMsMax: Number(process.env.GATE_WARM_LIST_MS || 10_000),
	renderMsMax: Number(process.env.GATE_RENDER_MS || 120_000),
};

const dir = e2eDir("e2e-perf");
const result = { passed: false, metrics: {}, gates: GATES, steps: [] };

async function timed(fn) {
	const start = Date.now();
	const value = await fn();
	return { ms: Date.now() - start, value };
}

try {
	// ---- fixtures ----------------------------------------------------------
	const tFixStart = Date.now();
	writeLinearSession({ dir, sessionId: BIG_ID, n: 5000 });
	for (let i = 0; i < PERF_SESSIONS; i++) {
		const bucket = `e2e-perf-${i % 20}`; // spread across 20 dirs like real cwds
		writeLinearSession({
			dir,
			sessionId: `e2e-perf-s${String(i).padStart(4, "0")}`,
			n: 4 + (i % 24),
			startContent: `perf session ${i} message`,
		});
		void bucket;
	}
	result.metrics.fixtureGenMs = Date.now() - tFixStart;
	result.steps.push(`wrote ${PERF_SESSIONS} small + 1 big session`);

	// ---- cold/warm list ----------------------------------------------------
	const cold = await timed(async () => {
		const res = await fetch(`${BASE}/api/sessions`, {
			signal: AbortSignal.timeout(180_000),
		});
		if (!res.ok) throw new Error(`/api/sessions -> ${res.status}`);
		return res.json();
	});
	result.metrics.coldListMs = cold.ms;
	result.steps.push(`cold list ${cold.ms}ms`);
	if (cold.ms > GATES.warmListMsMax * 18) {
		throw new Error(
			`cold list ${cold.ms}ms looks pathological (>18x warm gate)`,
		);
	}

	const warm = await timed(async () => {
		const res = await fetch(`${BASE}/api/sessions`, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) throw new Error(`/api/sessions -> ${res.status}`);
		return res.json();
	});
	result.metrics.warmListMs = warm.ms;
	result.steps.push(`warm list ${warm.ms}ms`);
	if (warm.ms > GATES.warmListMsMax) {
		throw new Error(
			`warm list ${warm.ms}ms exceeds gate ${GATES.warmListMsMax}ms`,
		);
	}

	// ---- detail/context on the big session ---------------------------------
	const ctx = await timed(() => assertTailWindow({ sessionId: BIG_ID, tail: 50 }));
	result.metrics.contextTail50Ms = ctx.ms;
	result.steps.push(`context tail=50 ${ctx.ms}ms (${ctx.value.length} msgs)`);
	if (ctx.ms > GATES.contextMsMax) {
		throw new Error(
			`context tail=50 ${ctx.ms}ms exceeds gate ${GATES.contextMsMax}ms`,
		);
	}

	// ---- browser render of the big session ---------------------------------
	const render = await timed(async () => {
		const b = await launchPage();
		try {
			await b.page.goto(`${BASE}/?session=${BIG_ID}`, {
				waitUntil: "domcontentloaded",
			});
			await b.page.waitForFunction(
				() => /load earlier/i.test(document.body.innerText || ""),
				null,
				{ timeout: GATES.renderMsMax },
			);
		} finally {
			await b.browser.close();
		}
	});
	result.metrics.pageRenderMs = render.ms;
	result.steps.push(`page render ${render.ms}ms`);
	if (render.ms > GATES.renderMsMax) {
		throw new Error(
			`page render ${render.ms}ms exceeds gate ${GATES.renderMsMax}ms`,
		);
	}

	result.passed = true;
} catch (e) {
	result.error = String(e);
} finally {
	cleanupDir(dir);
	resultLog(result);
	process.exit(result.passed ? 0 : 1);
}
