import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-transcript-notices-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  attachTranscriptNotices,
  collectLiveAssistantNotices,
  collectTranscriptNotices,
  readSessionTranscriptNotices,
  readShowCacheMissNotices,
  scanCacheMisses,
  withSessionPrices,
} = await jiti.import("./transcript-notices-server.ts");
const {
  formatCacheWarmCost,
  formatNoticeTokens,
  getTranscriptNotices,
  summarizeCacheMisses,
} = await jiti.import("./transcript-notices.ts");

// The SDK modules the port follows, loaded from the installed package.
const sdkDir = path.dirname(findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url));
const sdkCacheStats = await import(pathToFileURL(path.join(sdkDir, "dist/core/cache-stats.js")).href);
const sdkFooter = await import(pathToFileURL(path.join(sdkDir, "dist/modes/interactive/components/footer.js")).href);

const MODELS = {
  getModel: (provider, id) => (provider === "anthropic" && id === "opus" ? { cost: { cacheRead: 1.5 } } : undefined),
};
const T0 = Date.parse("2026-10-15T10:00:00.000Z");

/** A usage with the given token buckets, priced at $15/M input, $18.75/M write, $1.5/M read. */
function usage({ input = 0, output = 100, cacheRead = 0, cacheWrite = 0 } = {}) {
  const cost = {
    input: input * 15e-6,
    output: output * 75e-6,
    cacheRead: cacheRead * 1.5e-6,
    cacheWrite: cacheWrite * 18.75e-6,
  };
  return { input, output, cacheRead, cacheWrite, cost: { ...cost, total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite } };
}

let nextId = 0;
function entryBase(type, parentId, minutes) {
  nextId += 1;
  return { type, id: `e${nextId}`, parentId, timestamp: new Date(T0 + minutes * 60_000).toISOString() };
}
function user(parentId, minutes = 0) {
  return { ...entryBase("message", parentId, minutes), message: { role: "user", content: "hi", timestamp: T0 + minutes * 60_000 } };
}
function assistant(parentId, minutes, u, extra = {}) {
  return {
    ...entryBase("message", parentId, minutes),
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "opus",
      content: [{ type: "text", text: "ok" }],
      stopReason: "stop",
      timestamp: T0 + minutes * 60_000,
      usage: u,
      ...extra,
    },
  };
}
function toolResult(parentId, minutes) {
  return { ...entryBase("message", parentId, minutes), message: { role: "toolResult", toolCallId: "c1", content: [], timestamp: T0 + minutes * 60_000 } };
}
function cacheWarm(parentId, minutes, u, note) {
  return { ...entryBase("usage", parentId, minutes), kind: "cache_warm", provider: "anthropic", model: "opus", usage: u, ...(note ? { note } : {}) };
}
function compaction(parentId, minutes, u) {
  return { ...entryBase("compaction", parentId, minutes), summary: "s", firstKeptEntryId: parentId, tokensBefore: 120_000, ...(u ? { usage: u } : {}) };
}

/** Each entry's parent is the one before it. */
function chain(...makers) {
  const entries = [];
  for (const make of makers) entries.push(make(entries.at(-1)?.id ?? null));
  return entries;
}

function scenario() {
  return chain(
    (p) => user(p, 0),
    (p) => assistant(p, 0, usage({ input: 500, cacheWrite: 60_000 })),
    (p) => assistant(p, 1, usage({ input: 300, cacheRead: 60_000, cacheWrite: 2_000 })),
    (p) => toolResult(p, 1),
    (p) => cacheWarm(p, 4, usage({ cacheRead: 62_000, output: 1 }), "idle"),
    // A total miss after 12 minutes: nothing read, everything written again.
    (p) => assistant(p, 16, usage({ input: 200, cacheWrite: 64_000 })),
    (p) => user(p, 17),
    // A partial miss on a model switch.
    (p) => assistant(p, 17, usage({ input: 30_000, cacheRead: 30_000, cacheWrite: 5_000 }), { model: "sonnet" }),
    (p) => compaction(p, 18, usage({ input: 90_000, output: 3_000 })),
    // After a compaction the next prompt is new content, not a miss.
    (p) => assistant(p, 19, usage({ input: 5_000, cacheWrite: 20_000 })),
    // Below the noise floor.
    (p) => assistant(p, 19, usage({ input: 900, cacheRead: 24_000 })),
  );
}

test("the ported scan finds the misses the SDK's cache-stats finds", () => {
  const entries = scenario();
  const ours = scanCacheMisses(entries, MODELS).misses;
  const theirs = sdkCacheStats.collectCacheMisses(entries, MODELS);
  const theirsById = new Map();
  for (const entry of entries) {
    if (entry.type === "message" && theirs.has(entry.message)) theirsById.set(entry.id, theirs.get(entry.message));
  }
  assert.deepEqual(ours, theirsById);
  assert.ok(ours.size >= 2);

  // The live path matches the SDK's detectCacheMiss on every assistant message.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const before = entries.slice(0, i);
    const sdk = sdkCacheStats.detectCacheMiss(before, entry.message, MODELS);
    const live = collectLiveAssistantNotices(before, before, entry.message, MODELS).filter((n) => n.kind === "cache_miss");
    if (!sdk || (sdk.missedTokens < 20_000 && sdk.missedCost < 0.1)) assert.deepEqual(live, []);
    else assert.equal(live[0].missedTokens, sdk.missedTokens);
  }
});

test("collects the four notices onto the entries the chat shows", () => {
  const entries = scenario();
  const notices = collectTranscriptNotices(entries, MODELS);
  const [, first, second, , warm, idleMiss, , switchMiss, compact] = entries;

  assert.equal(notices.has(first.id), false);
  // Cache warming follows the assistant message whose tool result came before it.
  assert.deepEqual(notices.get(second.id), [{ kind: "cache_warm", cost: warm.usage.cost.total, note: "idle" }]);
  const [idle] = notices.get(idleMiss.id);
  assert.equal(idle.kind, "cache_miss");
  assert.equal(idle.idleMinutes, 12);
  assert.equal(idle.modelChanged, undefined);
  // 62k prompt tokens the warming had read, re-billed at the write price minus the read price.
  assert.equal(idle.missedTokens, 62_000);
  assert.ok(Math.abs(idle.missedCost - 62_000 * (18.75e-6 * 64_000 + 15e-6 * 200) / 64_200 + 62_000 * 1.5e-6) < 1e-9);
  assert.deepEqual(notices.get(switchMiss.id).map((n) => [n.kind, n.modelChanged]), [["cache_miss", true]]);
  assert.deepEqual(notices.get(compact.id), [{ kind: "summary_cost", source: "compaction", tokens: 93_000, cost: compact.usage.cost.total }]);
  assert.equal(notices.size, 4);
});

test("leaves out small misses, aborted replies and a miss priced without the model", () => {
  const entries = chain(
    (p) => user(p, 0),
    (p) => assistant(p, 0, usage({ input: 100, cacheWrite: 30_000 })),
    // 15k missed, about $0.26: shown for its cost.
    (p) => assistant(p, 1, usage({ input: 100, cacheRead: 15_000, cacheWrite: 15_100 })),
    (p) => assistant(p, 2, usage({ input: 100, cacheWrite: 30_300 }), { stopReason: "aborted" }),
  );
  const notices = collectTranscriptNotices(entries, MODELS);
  assert.equal(notices.get(entries[2].id)?.[0].kind, "cache_miss");
  assert.equal(notices.has(entries[3].id), false);

  // A cheap provider: 1500 tokens missed at $1/M is below both thresholds.
  const cheap = chain(
    (p) => user(p, 0),
    (p) => assistant(p, 0, { ...usage({ input: 100, cacheWrite: 3_000 }), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0.003, total: 0.003 } }),
    (p) => assistant(p, 1, { ...usage({ input: 100, cacheRead: 1_500, cacheWrite: 1_500 }), cost: { input: 0, output: 0, cacheRead: 0.0001, cacheWrite: 0.0015, total: 0.0016 } }),
  );
  assert.equal(collectTranscriptNotices(cheap, MODELS).size, 0);
});

test("thinking drops show only when more were dropped than for the response before", () => {
  const dropped = (count) => ({
    diagnostics: [{
      type: "anthropic_input_transformations",
      details: { transformations: Array.from({ length: count }, () => ({ type: "thinking_dropped" })) },
    }],
  });
  const u = usage({ input: 10 });
  const entries = chain(
    (p) => user(p, 0),
    (p) => assistant(p, 0, u, dropped(2)),
    (p) => assistant(p, 0, u, dropped(2)),
    (p) => assistant(p, 0, u, dropped(3)),
  );
  const notices = collectTranscriptNotices(entries, MODELS);
  assert.deepEqual(notices.get(entries[1].id), [{ kind: "thinking_dropped", count: 2 }]);
  assert.equal(notices.has(entries[2].id), false);
  assert.deepEqual(notices.get(entries[3].id), [{ kind: "thinking_dropped", count: 3 }]);

  // Live, the message may or may not be in the entries yet.
  const last = entries[3].message;
  assert.deepEqual(collectLiveAssistantNotices(entries.slice(0, 3), entries.slice(0, 3), last, MODELS), [{ kind: "thinking_dropped", count: 3 }]);
  assert.deepEqual(collectLiveAssistantNotices(entries, entries, last, MODELS), [{ kind: "thinking_dropped", count: 3 }]);
});

test("a branch summary's cost follows it; one without a summary shows nothing", () => {
  const entries = chain(
    (p) => user(p, 0),
    (p) => ({ ...entryBase("branch_summary", p, 1), fromId: p, summary: "went elsewhere", usage: usage({ input: 4_000, output: 500 }) }),
    (p) => ({ ...entryBase("branch_summary", p, 2), fromId: p, summary: "", usage: usage({ input: 4_000 }) }),
  );
  const notices = collectTranscriptNotices(entries, MODELS);
  assert.deepEqual(notices.get(entries[1].id).map((n) => [n.kind, n.source, n.tokens]), [["summary_cost", "branch_summary", 4_500]]);
  assert.equal(notices.has(entries[2].id), false);
});

test("attaches notices to copies of the page's messages", () => {
  const messages = [{ role: "user", content: "a" }, { role: "assistant", content: [] }];
  const context = { messages, entryIds: ["u", "a"], hasMore: false };
  const notice = { kind: "thinking_dropped", count: 1 };
  const attached = attachTranscriptNotices(context, new Map([["a", [notice]], ["elsewhere", [notice]]]));
  assert.notEqual(attached.messages, messages);
  assert.equal(attached.messages[0], messages[0]);
  assert.deepEqual(getTranscriptNotices(attached.messages[1]), [notice]);
  assert.deepEqual(getTranscriptNotices(messages[1]), []);
  assert.equal(attachTranscriptNotices(context, undefined), context);
});

test("follows pi's showCacheMissNotices: off by default, a project file overrides the global one", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "pi-web-transcript-notices-project-"));
  try {
    const entries = scenario();
    assert.equal(await readSessionTranscriptNotices({ entries, cwd: project, models: MODELS }), undefined);

    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ showCacheMissNotices: true }));
    assert.equal((await readSessionTranscriptNotices({ entries, cwd: project, models: MODELS })).size, 4);

    await mkdir(path.join(project, ".pi"));
    await writeFile(path.join(project, ".pi", "settings.json"), JSON.stringify({ showCacheMissNotices: false }));
    assert.equal(await readSessionTranscriptNotices({ entries, cwd: project, models: MODELS }), undefined);
  } finally {
    await rm(path.join(agentDir, "settings.json"), { force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("prices a total miss from the session's own cache reads, the same figure as the catalog's", () => {
  const entries = scenario();
  const withCatalog = collectTranscriptNotices(entries, MODELS);
  const fromSession = collectTranscriptNotices(entries, withSessionPrices(entries));
  assert.deepEqual(fromSession, withCatalog);
  // A runtime is asked only for a model the session never read a cache with.
  let asked = 0;
  collectTranscriptNotices(entries, withSessionPrices(entries, { getModel: () => { asked += 1; return undefined; } }));
  assert.equal(asked, 0);
});

test("cache warming shows only on the branch it was billed on", () => {
  const [u, a, warm] = chain(
    (p) => user(p, 0),
    (p) => assistant(p, 0, usage({ input: 10 })),
    (p) => cacheWarm(p, 4, usage({ cacheRead: 5_000, output: 1 })),
  );
  const userA = user(warm.id, 5);
  const userB = user(a.id, 6);
  const entries = [u, a, warm, userA, userB];
  assert.equal(collectTranscriptNotices(entries, MODELS, { leafId: userA.id }).get(a.id)?.[0].kind, "cache_warm");
  assert.equal(collectTranscriptNotices(entries, MODELS, { leafId: userB.id }).has(a.id), false);
});

test("reads the setting without pi's file lock, and again once the file changes", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "pi-web-transcript-notices-project-"));
  try {
    await mkdir(path.join(project, ".pi"));
    const projectSettings = path.join(project, ".pi", "settings.json");
    await writeFile(projectSettings, "\uFEFF" + JSON.stringify({ showCacheMissNotices: true }));
    assert.equal(readShowCacheMissNotices(project), true);
    assert.deepEqual(await readdir(path.join(project, ".pi")), ["settings.json"]);
    await writeFile(projectSettings, JSON.stringify({ showCacheMissNotices: false, other: 1 }));
    assert.equal(readShowCacheMissNotices(project), false);
    // A file pi cannot parse is skipped, as pi skips it.
    await writeFile(projectSettings, "{");
    assert.equal(readShowCacheMissNotices(project), false);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("client helpers format as the TUI and add up a fold's misses", () => {
  for (const count of [0, 999, 1_000, 8_499, 9_999, 10_000, 85_312, 999_999, 1_000_000, 1_250_000, 12_000_000]) {
    assert.equal(formatNoticeTokens(count), sdkFooter.formatTokens(count));
  }
  assert.equal(formatCacheWarmCost(0.0123, "en"), "$0.0123");
  assert.equal(formatCacheWarmCost(0.5, "en"), "$0.500");
  assert.equal(formatCacheWarmCost(0.000123, "en"), "$0.000123");
  assert.equal(formatCacheWarmCost(0.5, "zh-TW"), "$0.500");
  // Simplified Chinese converts first, then keeps the same six decimals and trailing-zero rule.
  assert.equal(formatCacheWarmCost(0.5, "zh-CN"), "¥3.345");
  assert.equal(formatCacheWarmCost(0.0123, "zh-CN"), "¥0.082287");

  const miss = (missedTokens, missedCost) => ({ transcriptNotices: [{ kind: "cache_miss", missedTokens, missedCost }] });
  assert.equal(summarizeCacheMisses([{ role: "user" }]), undefined);
  assert.deepEqual(
    summarizeCacheMisses([miss(60_000, 0.4), { transcriptNotices: [{ kind: "thinking_dropped", count: 1 }] }, miss(25_000, 0.02)]),
    { count: 2, missedTokens: 85_000, missedCost: 0.42000000000000004 },
  );
});
