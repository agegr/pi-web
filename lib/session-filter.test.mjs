import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  NO_SESSION_FILTER,
  SESSION_STATUS_FILTERS,
  SESSION_TIME_FILTERS,
  countHiddenFamilies,
  familyMatchesSessionFilter,
  isSessionFilterActive,
  sessionFilterCutoff,
} = await jiti.import("./session-filter.ts");

const NOW = new Date(2026, 2, 10, 15, 30, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();

function session(id, extra = {}) {
  return { path: `/s/${id}.jsonl`, id, cwd: "/work", created: iso(NOW), modified: iso(NOW), messageCount: 1, firstMessage: id, ...extra };
}

function family(id, { subagents = [], modified = NOW, failed = false } = {}) {
  return {
    root: session(id, failed ? { lastReplyFailed: true } : {}),
    subagents,
    latestModified: iso(modified),
  };
}

const context = (running = []) => ({ now: NOW, runningIds: new Set(running) });
const matches = (target, filter, running = []) => familyMatchesSessionFilter(target, filter, context(running));

test("both groups offer an unfiltered choice, and that choice shows everything", () => {
  assert.deepEqual(SESSION_STATUS_FILTERS, ["all", "running", "failed"]);
  assert.deepEqual(SESSION_TIME_FILTERS, ["all", "today", "week", "month"]);
  assert.equal(isSessionFilterActive(NO_SESSION_FILTER), false);
  assert.equal(isSessionFilterActive({ status: "failed", time: "all" }), true);
  // No date at all still shows under "all", as it always did.
  assert.equal(matches({ root: session("x"), subagents: [], latestModified: "not a date" }, NO_SESSION_FILTER), true);
});

test("running is the family's, like the row's own spinner", () => {
  const both = { ...family("root"), subagents: [session("child")] };
  assert.equal(matches(both, { status: "running", time: "all" }, ["child"]), true);
  assert.equal(matches(both, { status: "running", time: "all" }, ["root"]), true);
  assert.equal(matches(both, { status: "running", time: "all" }), false);
});

test("failed is the root's last reply: a long-finished subagent's error does not label its parent", () => {
  assert.equal(matches(family("root", { failed: true }), { status: "failed", time: "all" }), true);
  assert.equal(matches(family("root"), { status: "failed", time: "all" }), false);
  const withFailedChild = { ...family("root"), subagents: [session("child", { lastReplyFailed: true })] };
  assert.equal(matches(withFailedChild, { status: "failed", time: "all" }), false);
});

test("today is the local calendar day; the windows are rolling and inclusive", () => {
  const today = new Date(2026, 2, 10, 0, 0, 0).getTime();
  assert.equal(sessionFilterCutoff("today", NOW), today);
  assert.equal(sessionFilterCutoff("all", NOW), null);
  assert.equal(sessionFilterCutoff("week", NOW), NOW - 7 * 86_400_000);
  assert.equal(sessionFilterCutoff("month", NOW), NOW - 30 * 86_400_000);

  const justAfterMidnight = family("a", { modified: today + 1 });
  const lastNight = family("b", { modified: today - 1 });
  assert.equal(matches(justAfterMidnight, { status: "all", time: "today" }), true);
  assert.equal(matches(lastNight, { status: "all", time: "today" }), false);
  assert.equal(matches(family("c", { modified: NOW - 6 * 86_400_000 }), { status: "all", time: "week" }), true);
  assert.equal(matches(family("d", { modified: NOW - 8 * 86_400_000 }), { status: "all", time: "week" }), false);
  assert.equal(matches(family("e", { modified: NOW - 29 * 86_400_000 }), { status: "all", time: "month" }), true);
  assert.equal(matches(family("f", { modified: NOW - 31 * 86_400_000 }), { status: "all", time: "month" }), false);
});

test("a status and a window are combined with AND", () => {
  const filter = { status: "failed", time: "today" };
  assert.equal(matches(family("a", { failed: true, modified: NOW }), filter), true);
  assert.equal(matches(family("b", { failed: true, modified: NOW - 40 * 86_400_000 }), filter), false);
  assert.equal(matches(family("c", { modified: NOW }), filter), false);
});

test("the hidden count is zero without a filter, and counts only what it hides", () => {
  const families = [family("a", { failed: true }), family("b"), family("c")];
  assert.equal(countHiddenFamilies(families, NO_SESSION_FILTER, context()), 0);
  assert.equal(countHiddenFamilies(families, { status: "failed", time: "all" }, context()), 2);
  assert.equal(countHiddenFamilies(families, { status: "running", time: "all" }, context(["b"])), 2);
});
