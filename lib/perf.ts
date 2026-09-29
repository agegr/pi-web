// Optional server-side request timing for slow-path diagnosis.
//
// Enabled only when PI_WEB_PERF=1. Every instrumented route creates a
// collector at the top of its handler, marks phases with span(), and attaches
// the result to the outgoing response. When disabled every call is a cheap
// no-op so the hot paths stay untouched.
//
// Security: logs never include message bodies, absolute file paths, cookies,
// Authorization headers, or model credentials — only route names, durations,
// and coarse counts.

export interface ServerPerf {
	/** Record one phase: the duration since the previous span (or start). */
	span(name: string): void;
	/** Total wall-clock duration so far, in milliseconds. */
	totalMs(): number;
	/** Attach Server-Timing + a structured log line, then return the response. */
	attach<T extends { headers: Headers }>(response: T): T;
}

const PERF_ENABLED = process.env.PI_WEB_PERF === "1";

export function isServerPerfEnabled(): boolean {
	return PERF_ENABLED;
}

export function startServerPerf(route: string): ServerPerf | undefined {
	if (!PERF_ENABLED) return undefined;

	const requestId = crypto.randomUUID().slice(0, 8);
	const startedAt = performance.now();
	let lastMark = startedAt;
	const spans = new Map<string, number>();

	const perf: ServerPerf = {
		span(name) {
			const now = performance.now();
			spans.set(name, (spans.get(name) ?? 0) + (now - lastMark));
			lastMark = now;
		},
		totalMs() {
			return performance.now() - startedAt;
		},
		attach(response) {
			const totalMs = performance.now() - startedAt;
			const timing = [...spans.entries()]
				.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
				.join(", ");
			const headers = response.headers;
			headers.set(
				"Server-Timing",
				timing ? `${timing}, total;dur=${totalMs.toFixed(1)}` : `total;dur=${totalMs.toFixed(1)}`,
			);
			const phases: Record<string, number> = {};
			for (const [name, ms] of spans) phases[name] = Number(ms.toFixed(1));
			console.log(JSON.stringify({
				perf: true,
				route,
				requestId,
				totalMs: Number(totalMs.toFixed(1)),
				phases,
			}));
			return response;
		},
	};
	return perf;
}
