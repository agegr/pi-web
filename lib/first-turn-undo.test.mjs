import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getFirstTurnUndoTarget, planFirstTurnUndo } = await jiti.import("./first-turn-undo.ts");
const { undoFirstTurnFile } = await jiti.import("./first-turn-undo-file.ts");
const { sessionHistoryLocks, assertSessionHistoryAvailable } = await jiti.import("./session-history-lock.ts");
const header = { type: "session", version: 3, id: "session", cwd: "/workspace" };
const settings = { type: "model_change", id: "m", parentId: null, provider: "test", modelId: "test" };
const user = { type: "message", id: "u", parentId: "m", message: { role: "user", content: "typo" } };
const aborted = { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [], stopReason: "aborted" } };
const target = { entryId: "u", leafId: "a" };
const serialize = (entries) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

test("undo removes only the original first turn, preserving initial metadata and identity", () => {
  const entries = [settings, user, aborted];
  assert.deepEqual(getFirstTurnUndoTarget(header, entries, "a"), target);
  assert.equal(planFirstTurnUndo(serialize([header, ...entries]), "session", target), serialize([header, settings]));
  assert.equal(planFirstTurnUndo(serialize([header, { ...user, parentId: null }, aborted]), "session", target), serialize([header]));
});

test("a partially generated text/thinking response can be undone", () => {
  const reply = { ...aborted, message: { ...aborted.message, content: [{ type: "text", text: "partial" }, { type: "thinking", thinking: "partial" }] } };
  assert.deepEqual(getFirstTurnUndoTarget(header, [settings, user, reply], "a"), target);
});

test("rejects later turns, branches, tool activity, compaction, custom messages, and unfinished/completed turns", () => {
  const invalid = [
    [settings, user],
    [settings, user, { ...aborted, message: { ...aborted.message, stopReason: "stop" } }],
    [settings, user, { ...aborted, message: { ...aborted.message, stopReason: "error" } }],
    [settings, user, { ...aborted, message: { ...aborted.message, content: [{ type: "toolCall", name: "read" }] } }],
    [settings, user, { ...aborted, message: { ...aborted.message, role: "toolResult" } }],
    [settings, user, aborted, { ...user, id: "u2", parentId: "a" }, { ...aborted, id: "a2", parentId: "u2" }],
    [settings, user, aborted, { ...aborted, id: "branch", parentId: "u" }],
    [settings, user, aborted, { type: "custom", id: "c", parentId: "a" }],
    [{ type: "compaction", id: "m", parentId: null }, user, aborted],
    [{ type: "custom_message", id: "m", parentId: null }, user, aborted],
    [settings, { ...user, parentId: null }, aborted],
  ];
  for (const entries of invalid) assert.equal(getFirstTurnUndoTarget(header, entries, entries.at(-1)?.id), null);
  assert.equal(getFirstTurnUndoTarget({ ...header, parentSession: "/parent.jsonl" }, [settings, user, aborted], "a"), null);
  assert.equal(getFirstTurnUndoTarget(header, [settings, user, aborted], "u"), null);
  assert.throws(() => planFirstTurnUndo(serialize([header, settings, user, aborted]), "wrong-session", target));
  assert.throws(() => planFirstTurnUndo(serialize([header, settings, user, aborted]), "session", { ...target, entryId: "stale" }));
});

test("file replacement refuses concurrent edits or shutdown failures without discarding history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-first-undo-"));
  const file = join(dir, "session.jsonl");
  const original = serialize([header, settings, user, aborted]);
  try {
    await writeFile(file, original);
    await assert.rejects(undoFirstTurnFile(file, "session", target, async () => { throw new Error("shutdown failed"); }));
    assert.equal(await readFile(file, "utf8"), original);
    const changed = original + JSON.stringify({ type: "custom", id: "new", parentId: "a" }) + "\n";
    await assert.rejects(undoFirstTurnFile(file, "session", target, () => writeFile(file, changed)), /Session changed/);
    assert.equal(await readFile(file, "utf8"), changed);
    assert.deepEqual(await readdir(dir), ["session.jsonl"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("SDK can reopen the empty session and persist a corrected first round without an old branch", async () => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const dir = await mkdtemp(join(tmpdir(), "pi-first-undo-sdk-"));
  try {
    const manager = SessionManager.create(dir, dir);
    manager.appendModelChange("test", "model");
    manager.appendThinkingLevelChange("high");
    manager.appendCustomEntry("pi-web:tool-selection", { version: 1, toolNames: [] });
    manager.appendSessionInfo("Keep my session name");
    const content = [{ type: "text", text: "typo" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }];
    const uid = manager.appendMessage({ role: "user", content, timestamp: Date.now() });
    const aid = manager.appendMessage({ role: "assistant", content: [], stopReason: "aborted", timestamp: Date.now() });
    const path = manager.getSessionFile();
    const id = manager.getSessionId();
    const original = await readFile(path, "utf8");
    await undoFirstTurnFile(path, id, { entryId: uid, leafId: aid }, async () => {});
    const reopened = SessionManager.open(path);
    assert.equal(reopened.getSessionId(), id);
    assert.equal(reopened.getCwd(), dir);
    assert.equal(reopened.getSessionName(), "Keep my session name");
    assert.equal(reopened.buildSessionContext().messages.length, 0);
    assert.equal(reopened.buildSessionContext().thinkingLevel, "high");
    assert.deepEqual(reopened.buildSessionContext().model, { provider: "test", modelId: "model" });
    assert.ok(reopened.getEntries().some((entry) => entry.customType === "pi-web:tool-selection"));
    const correctedId = reopened.appendMessage({ role: "user", content: [{ type: "text", text: "corrected" }, content[1]], timestamp: Date.now() });
    reopened.appendMessage({ role: "assistant", content: [{ type: "text", text: "fresh answer" }], stopReason: "stop", timestamp: Date.now() });
    const again = SessionManager.open(path);
    assert.deepEqual(again.buildSessionContext().messages.map((message) => message.role), ["user", "assistant"]);
    assert.equal(again.getEntry(uid), undefined);
    assert.equal(again.getEntry(aid), undefined);
    assert.equal(again.getEntry(correctedId).message.content[1].data, content[1].data);
    assert.ok(original.includes("typo"));
    assert.ok(!(await readFile(path, "utf8")).includes("typo"));
    assert.equal((await readdir(dir)).filter((name) => name.endsWith(".jsonl")).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("history lock rejects overlapping writes and releases cleanly", () => {
  const locks = sessionHistoryLocks();
  locks.add("test");
  try { assert.throws(() => assertSessionHistoryAvailable("test")); }
  finally { locks.delete("test"); }
  assert.doesNotThrow(() => assertSessionHistoryAvailable("test"));
});
