// A run's messages keep their React keys when the session file is read again
// (#1184). The client side of each case is what useAgentSession holds during the
// run: the loaded window plus the optimistic prompt and the `message_end`
// appends, none with an entry id. The reloaded side is the real reader's output.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const { normalizeToolCalls } = await jiti.import("./normalize.ts");
const { messageRenderKeys, carryMessageKeys, withLiveUserEntryId } = await jiti.import("./message-keys.ts");

function session() {
  const entries = [];
  const add = (fields) => {
    const entry = {
      id: `e${String(entries.length).padStart(7, "0")}`,
      parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date(1_000_000 + entries.length * 1000).toISOString(),
      ...fields,
    };
    entries.push(entry);
    return entry;
  };
  const addMessage = (message) => add({ type: "message", message });
  return { entries, add, addMessage };
}

const user = (content, timestamp) => ({ role: "user", content, timestamp });
const assistant = (timestamp, content, extra = {}) => ({
  role: "assistant", content, timestamp, stopReason: "stop", provider: "p", model: "m", api: "x", usage: {}, ...extra,
});
const text = (timestamp, value, extra) => assistant(timestamp, [{ type: "text", text: value }], extra);
const toolCall = (timestamp, id) => assistant(timestamp, [
  { type: "thinking", thinking: "plan ".repeat(80) },
  { type: "toolCall", id, name: "read", arguments: { path: "a" } },
], { stopReason: "toolUse" });
const toolResult = (toolCallId, timestamp) => ({
  role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: "file" }], isError: false, timestamp,
});

// What loadSession reads (tail 50, deferred thinking and media).
const read = (entries, leafId = entries.at(-1).id) => buildSessionContext(entries, leafId, {
  deferThinking: true, deferToolResultImages: true, tail: 50, sessionId: "s",
});
const loaded = (entries) => ({ ...read(entries), aliases: new Map() });
// message_end appends normalized messages; handleSend appends the prompt as is.
const appended = (state, ...messages) => ({
  ...state, messages: [...state.messages, ...messages.map((m) => m.role === "assistant" ? normalizeToolCalls(m) : m)],
});
const reload = (state, entries, leafId) => {
  const next = read(entries, leafId);
  return { ...next, aliases: carryMessageKeys(state, next) };
};
const keysOf = (state) => messageRenderKeys(state.entryIds, state.messages.length, state.aliases);
const assertUnique = (keys) => assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);

function history() {
  const s = session();
  s.addMessage(user("earlier", 1));
  s.addMessage(text(2, "earlier answer"));
  return s;
}

test("a run's messages keep their keys when the run end reads the file", () => {
  const s = history();
  // The prompt goes out with the browser's timestamp, a custom message's entry
  // with its own: neither matches the file's, the rest is pi's message as is.
  const during = appended(
    loaded(s.entries),
    user("long ".repeat(500), 1_700_000_000_000),
    toolCall(3000, "c1"),
    toolResult("c1", 3100),
    { role: "custom", customType: "note", content: "hi", display: true, timestamp: 3150 },
    text(3200, "done"),
  );
  s.addMessage(user("long ".repeat(500), 1_700_000_000_123));
  s.addMessage(toolCall(3000, "c1"));
  s.addMessage(toolResult("c1", 3100));
  s.add({ type: "custom_message", customType: "note", content: "hi", display: true });
  s.addMessage(text(3200, "done"));
  const after = reload(during, s.entries);

  // The old rule, `entryIds[idx] ?? idx`, re-keyed the sent bubble from 2 to its id.
  const oldRule = (state) => state.messages.map((_, idx) => String(state.entryIds[idx] ?? idx));
  assert.notEqual(oldRule(during)[2], oldRule(after)[2]);

  assert.deepEqual(keysOf(after), keysOf(during));
  assert.deepEqual(keysOf(after).slice(0, 2), ["e0000000", "e0000001"]);
  assertUnique(keysOf(after));
});

test("a new session's first run keeps its keys", () => {
  const s = session();
  const during = appended({ messages: [], entryIds: [], aliases: new Map() }, user("q", 10), text(4000, "a"));
  s.add({ type: "model_change", provider: "p", modelId: "m" });
  s.addMessage(user("q", 11));
  s.addMessage(text(4000, "a"));
  assert.deepEqual(keysOf(reload(during, s.entries)), keysOf(during));
});

test("auto-retry: the reload before the retry and the one at the end keep every key", () => {
  const s = history();
  const failed = text(4000, "", { stopReason: "error", errorMessage: "429" });
  let state = appended(loaded(s.entries), user("q", 10), failed);
  const firstKeys = keysOf(state);
  s.addMessage(user("q", 11));
  const failedEntry = s.addMessage(failed);
  s.add({ type: "context_edit", targetId: failedEntry.id, replacement: null });
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), firstKeys);

  state = appended(state, text(9000, "ok"));
  const retriedKeys = keysOf(state);
  assertUnique(retriedKeys);
  s.addMessage(text(9000, "ok"));
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), retriedKeys);
});

test("a compaction in the middle of a run keeps the run's keys; the summary card takes its id", () => {
  const s = history();
  const during = appended(loaded(s.entries), user("q", 10), toolCall(5000, "c9"), toolResult("c9", 5001));
  const prompt = s.addMessage(user("q", 12));
  s.addMessage(toolCall(5000, "c9"));
  s.addMessage(toolResult("c9", 5001));
  const compaction = s.add({ type: "compaction", summary: "sum", firstKeptEntryId: prompt.id, tokensBefore: 1000 });
  let state = reload(during, s.entries);
  assert.deepEqual(keysOf(state), [...keysOf(during), compaction.id]);

  state = appended(state, text(6000, "after"));
  const runKeys = keysOf(state);
  s.addMessage(text(6000, "after"));
  assert.deepEqual(keysOf(reload(state, s.entries)), runKeys);
});

test("the prompt matches as pi delivered it: a skill swapped in at message_end, an image in pi's format", () => {
  const s = history();
  const skill = user("<skill name=\"x\">body</skill>\n\nargs", 20);
  const during = appended(loaded(s.entries), skill);
  s.addMessage(skill);
  assert.deepEqual(keysOf(reload(during, s.entries)), keysOf(during));

  const t = history();
  const optimistic = user([
    { type: "text", text: "see" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ], 1);
  const withImage = appended(loaded(t.entries), optimistic);
  t.addMessage(user([{ type: "text", text: "see" }, { type: "image", data: "AAAA", mimeType: "image/png" }], 2));
  assert.deepEqual(keysOf(reload(withImage, t.entries)), keysOf(withImage));
});

test("a message the browser missed ends the carry there: the rest take their ids, never a duplicate key", () => {
  const s = history();
  const during = appended(loaded(s.entries), user("q", 10), text(7002, "done"));
  const before = keysOf(during);
  s.addMessage(user("q", 11));
  const missed = s.addMessage(toolCall(7000, "cx"));
  s.addMessage(toolResult("cx", 7001));
  const done = s.addMessage(text(7002, "done"));
  const extra = s.addMessage(text(7003, "not received yet"));
  const after = reload(during, s.entries);
  const keys = keysOf(after);
  assert.equal(keys[2], before[2]);
  assert.deepEqual([keys[3], keys[5], keys[6]], [missed.id, done.id, extra.id]);
  assertUnique(keys);
  // The extra message's late message_end appends it a second time.
  assertUnique(keysOf(appended(after, text(7003, "not received yet"))));
});

test("a run past the first page: its start leaves the window, so the keys fall back to the ids", () => {
  const s = history();
  let during = appended(loaded(s.entries), user("q", 10));
  s.addMessage(user("q", 11));
  for (let i = 0; i < 60; i++) {
    during = appended(during, toolCall(10_000 + i * 2, `t${i}`), toolResult(`t${i}`, 10_001 + i * 2));
    s.addMessage(toolCall(10_000 + i * 2, `t${i}`));
    s.addMessage(toolResult(`t${i}`, 10_001 + i * 2));
  }
  const after = reload(during, s.entries);
  assert.equal(after.entryIds.includes("e0000001"), false);
  assert.deepEqual(keysOf(after), after.entryIds);
});

test("an older page prepended leaves the live keys alone", () => {
  const s = history();
  const page = read(s.entries);
  const recent = { messages: page.messages.slice(1), entryIds: page.entryIds.slice(1), aliases: new Map() };
  const during = appended(recent, user("q", 10), text(8000, "a"));
  const prepended = {
    ...during,
    messages: [page.messages[0], ...during.messages],
    entryIds: [page.entryIds[0], ...during.entryIds],
  };
  assert.deepEqual(keysOf(prepended).slice(1), keysOf(during));
});

test("a run on another branch from the same entry takes over its places, never a key twice", () => {
  const s = history();
  const branchPoint = s.entries.at(-1).id;
  let state = appended(loaded(s.entries), user("q", 10), text(4000, "a"));
  s.addMessage(user("q", 11));
  s.addMessage(text(4000, "a"));
  state = reload(state, s.entries);
  assert.equal(state.aliases.size, 2);

  // navigate_tree back to the earlier answer drops the other branch's aliases.
  state = reload(state, s.entries, branchPoint);
  assert.equal(state.aliases.size, 0);
  state = appended(state, user("other", 20), text(5000, "b"));
  const during = keysOf(state);
  s.add({ type: "message", parentId: branchPoint, message: user("other", 21) });
  s.addMessage(text(5000, "b"));
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), during);
  assertUnique(keysOf(state));
});

// #1746: a user message sent during the run gets its entry id from the
// wrapper's `user_message_entry`, which follows its `message_end`; only for its
// New session, so its key stays live.
test("a delivered user message takes the entry id the wrapper names right after it", () => {
  const bubble = { role: "user", content: "same", timestamp: 1 };
  const delivered = { role: "user", content: "same", timestamp: 2 };
  const ids = withLiveUserEntryId(new Map(), { timestamp: 2, messages: [bubble, delivered] }, { type: "user_message_entry", entryId: "e1", timestamp: 2 });
  assert.equal(ids.get(bubble), "e1");
  assert.equal(ids.get(delivered), "e1");

  // A second prompt with the same text is another object: it waits for its own entry.
  const again = { role: "user", content: "same", timestamp: 3 };
  assert.equal(ids.get(again), undefined);
  const both = withLiveUserEntryId(ids, { timestamp: 3, messages: [again] }, { type: "user_message_entry", entryId: "e2", timestamp: 3 });
  assert.equal(both.get(again), "e2");
  assert.equal(both.get(bubble), "e1");

  // An entry for a message_end the chat did not show, or none at all, names nothing.
  const unseen = { role: "user", content: "x", timestamp: 4 };
  assert.equal(withLiveUserEntryId(both, { timestamp: 4, messages: [unseen] }, { type: "user_message_entry", entryId: "e3", timestamp: 5 }), both);
  assert.equal(withLiveUserEntryId(both, null, { type: "user_message_entry", entryId: "e3", timestamp: 5 }), both);
  assert.equal(withLiveUserEntryId(both, { timestamp: 4, messages: [unseen] }, { type: "user_message_entry", timestamp: 4 }), both);

  // Keys stay live: the id is not one of the loaded entries.
  assert.deepEqual(messageRenderKeys(["a"], 2, new Map()), ["a", "live:a:0"]);
});
