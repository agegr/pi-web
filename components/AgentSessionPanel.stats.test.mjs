import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { fetchAgentUsage } = await jiti.import("./AgentSessionPanel.tsx");
const { MAX_SESSION_STATS_IDS } = await jiti.import("@/lib/session-stats");

function usage(n) {
  return { tokens: { input: n, output: 0, cacheRead: 0, cacheWrite: 0, total: n }, cost: 0, toolCalls: 0, totalActiveMs: n };
}

// Answers like POST /api/sessions/stats: 400 past the cap, else every id's usage.
function statsRoute(requests, failAt = -1) {
  return async (url, init) => {
    assert.equal(url, "/api/sessions/stats");
    const { ids } = JSON.parse(init.body);
    requests.push(ids);
    if (ids.length > MAX_SESSION_STATS_IDS || requests.length - 1 === failAt) {
      return new Response(JSON.stringify({ error: "refused" }), { status: 400 });
    }
    return Response.json({ stats: Object.fromEntries(ids.map((id) => [id, usage(Number(id.slice(1)))])) });
  };
}

test("a family past the stats route's cap gets every agent's usage (#1728)", async () => {
  const ids = Array.from({ length: MAX_SESSION_STATS_IDS * 2 + 5 }, (_, i) => `s${i}`);
  const requests = [];
  const stats = await fetchAgentUsage(ids, undefined, statsRoute(requests));
  assert.deepEqual(requests.map((batch) => batch.length), [MAX_SESSION_STATS_IDS, MAX_SESSION_STATS_IDS, 5]);
  assert.deepEqual(requests.flat(), ids);
  assert.equal(Object.keys(stats).length, ids.length);
  assert.deepEqual(stats.s0, usage(0));
  assert.deepEqual(stats[`s${ids.length - 1}`], usage(ids.length - 1));
});

test("a family within the cap still takes one request", async () => {
  const requests = [];
  const stats = await fetchAgentUsage(["s1", "s2"], undefined, statsRoute(requests));
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(stats), ["s1", "s2"]);
});

test("a failed batch answers null, so rows keep their last numbers", async () => {
  const ids = Array.from({ length: MAX_SESSION_STATS_IDS + 1 }, (_, i) => `s${i}`);
  assert.equal(await fetchAgentUsage(ids, undefined, statsRoute([], 1)), null);
});
