import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SIDE_CHAT_BLOCKED_TOOLS,
  SIDE_CHAT_CUSTOM_TYPE,
  buildSideChatBoundaryText,
  buildSideChatSeed,
  isSideChatBoundaryEntry,
  restrictSideChatTools,
} = await jiti.import("./side-chat.ts");

const base = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms) => new Date(base + ms).toISOString();
let nextId = 0;

function entry(type, ms, extra = {}) {
  return { type, id: `e${++nextId}`, parentId: null, timestamp: iso(ms), ...extra };
}

function user(ms, text) {
  return entry("message", ms, { message: { role: "user", content: text, timestamp: base + ms } });
}

function assistant(ms, text) {
  return entry("message", ms, {
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      provider: "p",
      model: "m",
      stopReason: "stop",
      timestamp: base + ms,
    },
  });
}

function toolResult(ms, toolCallId = "c1") {
  return entry("message", ms, {
    message: { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }], timestamp: base + ms },
  });
}

function header() {
  return entry("session", 0, { id: "parent-header" });
}

/** Chain entry.parentId through the previous entry, as a real session does. */
function chain(...entries) {
  return entries.map((e, i) => ({ ...e, parentId: i === 0 ? null : entries[i - 1].id }));
}

test("seeds the active branch without the parent session header", () => {
  const entries = chain(header(), user(1000, "main task"), assistant(2000, "working on it"));
  const seed = buildSideChatSeed(entries, entries[entries.length - 1].id);
  assert.deepEqual(seed.entries.map((e) => e.type), ["message", "message"]);
  assert.equal(seed.entries.some((e) => e.type === "session"), false);
  assert.equal(seed.leafId, entries[entries.length - 1].id);
});

test("inherits only the branch the parent is on, never abandoned branches", () => {
  const root = user(1000, "question");
  const kept = assistant(2000, "kept answer");
  const dropped = assistant(2500, "abandoned answer");
  const branch = user(3000, "follow-up on the kept answer");
  const entries = [
    root,
    { ...kept, parentId: root.id },
    { ...dropped, parentId: root.id }, // sibling: not on the active branch
    { ...branch, parentId: kept.id },
  ];

  const seed = buildSideChatSeed(entries, branch.id);
  assert.deepEqual(seed.entries.map((e) => e.id), [root.id, kept.id, branch.id]);
  assert.equal(seed.entries.some((e) => e.id === dropped.id), false);
  assert.equal(seed.leafId, branch.id);
});

test("counts inherited messages and tool results separately", () => {
  const entries = chain(user(1000, "go"), assistant(2000, "step"), toolResult(3000), assistant(4000, "done"));
  const seed = buildSideChatSeed(entries, null);
  assert.equal(seed.inheritedMessages, 3);
  assert.equal(seed.inheritedToolCalls, 1);
  assert.equal(seed.droppedEntries, 0);
});

test("caps the inherited branch and reports how much was dropped from the front", () => {
  const entries = chain(
    user(1000, "one"),
    assistant(2000, "two"),
    user(3000, "three"),
    assistant(4000, "four"),
  );
  const seed = buildSideChatSeed(entries, null, 2);
  assert.deepEqual(seed.entries.map((e) => e.id), [entries[2].id, entries[3].id]);
  assert.equal(seed.droppedEntries, 2);
  // The tip must survive the trim, otherwise the fork would branch from the middle.
  assert.equal(seed.leafId, entries[3].id);
});

test("an empty parent yields an empty seed", () => {
  const seed = buildSideChatSeed([], null);
  assert.deepEqual(seed, {
    entries: [],
    leafId: null,
    inheritedMessages: 0,
    inheritedToolCalls: 0,
    droppedEntries: 0,
  });
});

test("a parent that only has a header yields an empty seed", () => {
  const entries = [header()];
  const seed = buildSideChatSeed(entries, null);
  assert.deepEqual(seed.entries, []);
  assert.equal(seed.leafId, null);
});

test("withholds mutating and subagent tools from the side conversation", () => {
  const parentTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "Agent", "steer_subagent"];
  const allowed = restrictSideChatTools(parentTools);
  assert.deepEqual(allowed, ["read", "bash", "grep", "find", "ls"]);
  for (const blocked of SIDE_CHAT_BLOCKED_TOOLS) {
    assert.equal(allowed.includes(blocked), false, `${blocked} must not survive`);
  }
});

test("keeps shell tools, because exploration runs through them", () => {
  const allowed = restrictSideChatTools(["read", "bash", "powershell"]);
  assert.deepEqual(allowed, ["read", "bash", "powershell"]);
});

test("an empty parent tool list stays empty (all tools off)", () => {
  assert.deepEqual(restrictSideChatTools([]), []);
});

test("boundary text names the parent and states every rule", () => {
  const text = buildSideChatBoundaryText({
    parentSessionId: "abc-123",
    parentSessionName: "轨迹面板",
    inheritedMessages: 12,
  });
  assert.match(text, /abc-123/);
  assert.match(text, /轨迹面板/);
  assert.match(text, /12 messages/);
  // Rules 1-6, one line each.
  for (const rule of ["1.", "2.", "3.", "4.", "5.", "6."]) {
    assert.equal(text.includes(`\n${rule} `), true, `missing rule ${rule}`);
  }
  assert.match(text, /Only messages submitted below it are active instructions/);
  assert.match(text, /subagents/);
  assert.match(text, /unless the user explicitly asks/);
  assert.equal(text.includes("undefined"), false);
  assert.equal(text.includes("null"), false);
});

test("boundary text reports dropped history only when history was dropped", () => {
  const without = buildSideChatBoundaryText({ parentSessionId: "p", inheritedMessages: 3 });
  assert.equal(without.includes("dropped"), false);

  const withDrops = buildSideChatBoundaryText({
    parentSessionId: "p",
    inheritedMessages: 3,
    droppedEntries: 40,
  });
  assert.match(withDrops, /oldest 40 entries were dropped/);
});

test("boundary text handles a parent with no earlier messages", () => {
  const text = buildSideChatBoundaryText({ parentSessionId: "p", inheritedMessages: 0 });
  assert.match(text, /no earlier messages/);
});

test("recognizes only this feature's boundary entries", () => {
  assert.equal(isSideChatBoundaryEntry({ type: "custom_message", customType: SIDE_CHAT_CUSTOM_TYPE }), true);
  assert.equal(isSideChatBoundaryEntry({ type: "custom_message", customType: "pi-web-timing" }), false);
  assert.equal(isSideChatBoundaryEntry({ type: "custom", customType: SIDE_CHAT_CUSTOM_TYPE }), false);
  assert.equal(isSideChatBoundaryEntry({ type: "message" }), false);
});
