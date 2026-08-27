// Performance bench: quantifies real-world-shaped load on a pristine dev server.
// Runs in its own CI job (no warmed caches, no deps on the e2e/ harness).
//
// What it measures (printed as JSON; gates are deliberately generous — they
// catch order-of-magnitude regressions, not runner noise):
//   coldListMs      first GET /api/sessions with PERF_SESSIONS fixture sessions
//                   on disk (includes dev-route compile)
//   warmListMs      second GET /api/sessions (cache-hit path)
//   contextTail50Ms GET /api/sessions/<big>/context?tail=50 on a 5000-msg session
//   pageFirstByteMs browser-free: HTML size of the home page on disk route
//                   (full browser render is intentionally out of scope here;
//                   that needs the e2e harness, not this bench)
//
// Honest caveat: numbers are dev-server figures on shared CI runners. They
// are for trend/regression detection, not absolute user-perceived latency.
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const BASE = process.env.PERF_BASE || "http://127.0.0.1:3100";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ||
  join(tmpdir(), `pi-web-perf-${randomUUID()}`);
const PERF_SESSIONS = Number(process.env.PERF_SESSIONS || 200);
const BIG_ID = "e2e-perf-big-5000";
const BIG_N = 5000;
const GATES = {
  contextMsMax: Number(process.env.GATE_CONTEXT_MS || 5000),
  warmListMsMax: Number(process.env.GATE_WARM_LIST_MS || 10_000),
};

const result = { passed: false, metrics: {}, gates: GATES, steps: [] };

function encodeCwd(cwd) {
  // Match session-reader.ts defaultSessionsDir resolution: slugified path.
  return cwd.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "default";
}

function writeLinearSession({ dir, sessionId, n, startContent }) {
  const projectDir = join(dir, encodeCwd(`/tmp/${sessionId}`));
  mkdirSync(projectDir, { recursive: true });
  const filePath = join(projectDir, `${new Date("2026-01-01T00:00:00.000Z").toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: `/tmp/${sessionId}`,
    }),
  ];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const content = i === 0 && startContent
      ? startContent
      : `message ${i} for ${sessionId}`;
    const entry = {
      type: "message",
      id: `e${sessionId}${i}`,
      parentId: i === 0 ? null : `e${sessionId}${i - 1}`,
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      message: role === "user"
        ? { role: "user", content }
        : { role: "assistant", provider: "test", model: "test-model", content: [{ type: "text", text: content }] },
    };
    lines.push(JSON.stringify(entry));
  }
  writeFileSync(filePath, lines.join("\n") + "\n");
}

async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { ms: Date.now() - start, value };
}

try {
  // ---- fixtures ----------------------------------------------------------
  const tFixStart = Date.now();
  writeLinearSession({ dir: AGENT_DIR, sessionId: BIG_ID, n: BIG_N });
  for (let i = 0; i < PERF_SESSIONS; i++) {
    writeLinearSession({
      dir: AGENT_DIR,
      sessionId: `e2e-perf-s${String(i).padStart(4, "0")}`,
      n: 4 + (i % 24),
      startContent: `perf session ${i} message`,
    });
  }
  result.metrics.fixtureGenMs = Date.now() - tFixStart;
  result.steps.push(`wrote ${PERF_SESSIONS} small + 1 big session under ${AGENT_DIR}`);

  // The bench runs against a dev server spawned by CI with PI_CODING_AGENT_DIR
  // pointing at our fixture root. If the server's agent dir is elsewhere,
  // /api/sessions will return [] and warmListMs becomes meaningless. Surface
  // a clear failure if so.
  const probe = await timed(async () => {
    const res = await fetch(`${BASE}/api/sessions`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`/api/sessions -> ${res.status}`);
    return res.json();
  });
  const probeCount = Array.isArray(probe.value?.sessions) ? probe.value.sessions.length : 0;
  if (probeCount < PERF_SESSIONS / 2) {
    throw new Error(
      `bench fixture not visible to server (saw ${probeCount} sessions, expected ~${PERF_SESSIONS}). ` +
      `Set PI_CODING_AGENT_DIR=${AGENT_DIR} in the dev-server env.`,
    );
  }

  // ---- cold/warm list ----------------------------------------------------
  const cold = await timed(async () => {
    const res = await fetch(`${BASE}/api/sessions`, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`/api/sessions -> ${res.status}`);
    return res.json();
  });
  result.metrics.coldListMs = cold.ms;
  result.steps.push(`cold list ${cold.ms}ms (${probeCount} sessions)`);
  if (cold.ms > GATES.warmListMsMax * 18) {
    throw new Error(`cold list ${cold.ms}ms looks pathological (>18x warm gate)`);
  }

  const warm = await timed(async () => {
    const res = await fetch(`${BASE}/api/sessions`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`/api/sessions -> ${res.status}`);
    return res.json();
  });
  result.metrics.warmListMs = warm.ms;
  result.steps.push(`warm list ${warm.ms}ms`);
  if (warm.ms > GATES.warmListMsMax) {
    throw new Error(`warm list ${warm.ms}ms exceeds gate ${GATES.warmListMsMax}ms`);
  }

  // ---- context tail=50 on the big session --------------------------------
  const ctx = await timed(async () => {
    const res = await fetch(
      `${BASE}/api/sessions/${encodeURIComponent(BIG_ID)}/context?tail=50`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new Error(`/context -> ${res.status}`);
    return res.json();
  });
  const ctxMsgs = Array.isArray(ctx.value?.context?.messages) ? ctx.value.context.messages.length : -1;
  result.metrics.contextTail50Ms = ctx.ms;
  result.steps.push(`context tail=50 ${ctx.ms}ms (${ctxMsgs} msgs)`);
  if (ctx.ms > GATES.contextMsMax) {
    throw new Error(`context tail=50 ${ctx.ms}ms exceeds gate ${GATES.contextMsMax}ms`);
  }

  // ---- page first byte: HTML size, no browser ---------------------------
  // Browser-render measurement is intentionally deferred: a faithful render
  // bench needs the e2e harness (playwright), which is out of scope for this
  // independent measurement PR.
  const page = await timed(async () => {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`/ -> ${res.status}`);
    const text = await res.text();
    return text.length;
  });
  result.metrics.pageFirstByteBytes = page.value;
  result.steps.push(`page HTML ${page.value} bytes`);

  result.passed = true;
} catch (e) {
  result.error = String(e);
} finally {
  if (existsSync(AGENT_DIR) && AGENT_DIR.startsWith(tmpdir())) {
    try { rmSync(AGENT_DIR, { recursive: true, force: true }); } catch {}
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.passed ? 0 : 1);
}
