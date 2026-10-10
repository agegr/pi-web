import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, tsconfigPaths: true });
const {
  mergeSessions,
  previewSessionMerge,
  textShingles,
  SessionMergeError,
} = await jiti.import("./session-merge.ts");
const { cacheSessionPath } = await jiti.import("./session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

/** A scratch agent dir and session dir: nothing here may reach the real ~/.pi. */
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-session-merge-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHome = process.env.HOME;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.HOME = join(root, "home");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  return { cwd: join(root, "project"), sessionDir: join(root, "sessions") };
}

const user = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() });

function lines(path) {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function messageTexts(path) {
  return lines(path)
    .filter((entry) => entry.type === "message")
    .map((entry) => (
      typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0].text
    ));
}

function sameSession(dirs) {
  const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
  manager.appendMessage(user("what is the weather"));
  manager.appendMessage(assistant("it is sunny today"));
  cacheSessionPath(manager.getSessionId(), manager.getSessionFile());
  return { manager, path: manager.getSessionFile() };
}
// ── Similarity ──────────────────────────────────────────────────────────────

test("identical sessions score 1 and unrelated sessions score near 0", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  const b = sameSession(dirs);
  const c = SessionManager.create(dirs.cwd, dirs.sessionDir);
  c.appendMessage(user("how do I configure the router's vlan tagging"));
  c.appendMessage(assistant("that is a networking question, not weather"));
  cacheSessionPath(c.getSessionId(), c.getSessionFile());

  const preview = await previewSessionMerge([a.manager.getSessionId(), b.manager.getSessionId(), c.getSessionId()]);
  const isIdentical = (pa, pb) => (p) => p.aId === pa && p.bId === pb;
  const ab = preview.pairs.find(isIdentical(a.manager.getSessionId(), b.manager.getSessionId()));
  const ac = preview.pairs.find(isIdentical(a.manager.getSessionId(), c.getSessionId()));
  assert.ok(ab && ac);
  assert.equal(ab.score, 1, "identical JSONL content scores 1");
  assert.equal(preview.suggested, false, "one dissimilar pair vetoes the suggestion");
  assert.ok(ac.score < 0.3, "unrelated sessions stay below the warning line");
});

test("fixword shingles distinguish Chinese by bigram", () => {
  const a = textShingles("合并会话功能开发");
  const b = textShingles("合并会话功能开发");
  const c = textShingles("天气查询");
  assert.equal(a.has("c:合并"), true);
  assert.equal(a.has("c:会话"), true);
  assert.ok(a.size > 0);
  assert.deepEqual([...a].sort(), [...b].sort());
  // The two Chinese strings share no bigram (both short), so the bags differ.
  assert.equal([...a].every((shingle) => c.has(shingle)), false);
});

test("English words from both sides of a task overlap", () => {
  const a = textShingles("fix the markdown monospace rendering in app/globals.css");
  const b = textShingles("markdown monospace in globals.css is broken, fix it please");
  const shared = [...a].filter((shingle) => b.has(shingle));
  assert.ok(shared.length > 0, "the shared words are fingerprinted");
});

// ── Merge ───────────────────────────────────────────────────────────────────

test("merges two sessions into one file beside the main session and deletes the sources", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  const b = sameSession(dirs);
  // Different content so merge runs: identical content is fine to merge too.
  const b2 = SessionManager.create(dirs.cwd, dirs.sessionDir);
  b2.appendMessage(user("what is the weather tomorrow"));
  b2.appendMessage(assistant("probably still sunny"));
  cacheSessionPath(b2.getSessionId(), b2.getSessionFile());

  const result = await mergeSessions([a.manager.getSessionId(), b2.getSessionId()], true);
  assert.ok(result.path.endsWith(`_${result.sessionId}.jsonl`));
  assert.ok(existsSync(result.path));
  assert.ok(result.deletedIds.includes(a.manager.getSessionId()));
  assert.ok(result.deletedIds.includes(b2.getSessionId()));
  assert.equal(existsSync(a.path), false);
  assert.equal(existsSync(b2.path), false);

  const [header, ...entries] = lines(result.path);
  assert.equal(header.type, "session");
  assert.equal(header.id, result.sessionId);
  assert.equal(header.cwd, dirs.cwd);
  assert.equal(header.parentSession, undefined, "a merge drops the parent link");
  // The main session's messages come first, then a marker, then the other's.
  const texts = messageTexts(result.path);
  assert.equal(texts[0], "what is the weather");
  assert.equal(texts[1], "it is sunny today");
  assert.equal(texts[2], "what is the weather tomorrow");
  assert.equal(texts[3], "probably still sunny");
  const marker = entries.find((entry) => entry.type === "custom_message");
  assert.ok(marker, "a marker names where the appended session began");
  assert.equal(marker.customType, "pi-web:session-merge-marker");
  const messageEntries = entries.filter((entry) => entry.type === "message");
  const lastMainId = messageEntries[1].id;
  assert.equal(marker.parentId, lastMainId, "the marker hangs off the main session's last message");

  // Every entry has a unique id and every non-root parentId points at a
  // present entry: the merged file is a valid tree.
  const ids = new Set(entries.map((entry) => entry.id));
  assert.equal(ids.size, entries.length, "entry ids are unique");
  for (const entry of entries) {
    if (entry.parentId == null) continue;
    assert.ok(ids.has(entry.parentId), `parent ${entry.parentId} of ${entry.id} exists`);
  }
});

test("refuses dissimilar sessions without force", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  const b = SessionManager.create(dirs.cwd, dirs.sessionDir);
  b.appendMessage(user("how do I configure the router's vlan tagging"));
  b.appendMessage(assistant("that is a networking question, not weather"));
  cacheSessionPath(b.getSessionId(), b.getSessionFile());

  await assert.rejects(
    mergeSessions([a.manager.getSessionId(), b.getSessionId()]),
    (error) => error instanceof SessionMergeError && error.code === "not_similar",
  );
  assert.ok(existsSync(a.path), "nothing is deleted on refusal");
  assert.ok(existsSync(b.getSessionFile()));
});

test("declines to merge fewer than two sessions, and unknown ids", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  await assert.rejects(
    mergeSessions([a.manager.getSessionId()]),
    (error) => error instanceof SessionMergeError && error.code === "too_few",
  );
  await assert.rejects(
    mergeSessions([a.manager.getSessionId(), "does-not-exist"]),
    (error) => error instanceof SessionMergeError && error.code === "not_found",
  );
});

test("refuses cross-directory sessions in the default same-directory mode", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  // A second project: same content, different cwd. The session file lives in
  // the same scratch session dir (the test harness pins it), but the header
  // cwd is what the merge's same-directory check reads.
  const other = join(dirs.cwd, "..", "other-project");
  const b2 = SessionManager.create(other, dirs.sessionDir);
  b2.appendMessage(user("what is the weather"));
  b2.appendMessage(assistant("it is sunny today"));
  cacheSessionPath(b2.getSessionId(), b2.getSessionFile());

  const preview = await previewSessionMerge([a.manager.getSessionId(), b2.getSessionId()]);
  assert.equal(preview.sameDirectory, false, "different headers report different directories");
  await assert.rejects(
    mergeSessions([a.manager.getSessionId(), b2.getSessionId()]),
    (error) => error instanceof SessionMergeError && error.code === "cross_cwd",
  );
  assert.ok(existsSync(a.path), "nothing is deleted on refusal");
  assert.ok(existsSync(b2.getSessionFile()));

  // sameCwdOnly=false lets the same two sessions merge, like the UI's toggle.
  const result = await mergeSessions([a.manager.getSessionId(), b2.getSessionId()], true, false);
  assert.ok(existsSync(result.path));
  assert.equal(existsSync(a.path), false);
  assert.equal(existsSync(b2.getSessionFile()), false);
});

test("same-directory sessions preview as sameDirectory and merge by default", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  const b = sameSession(dirs);
  const preview = await previewSessionMerge([a.manager.getSessionId(), b.manager.getSessionId()]);
  assert.equal(preview.sameDirectory, true);
  const result = await mergeSessions([a.manager.getSessionId(), b.manager.getSessionId()]);
  assert.ok(existsSync(result.path));
});

test("a source carrying subagent metadata is refused by preview and merge", async (t) => {
  const dirs = await scratch(t);
  const a = sameSession(dirs);
  const b = sameSession(dirs);
  // Stash a pi-web:subagent metadata entry into b's file, exactly as the SDK
  // writes it for a subagent run. readSubagentRun() keys on this entry.
  const meta = {
    type: "custom",
    customType: "pi-web:subagent",
    id: "deadbeef",
    parentId: b.manager.getLeafId(),
    timestamp: new Date().toISOString(),
    data: { version: 1, parentSessionId: "p-1", parentSessionPath: "/tmp/parent.jsonl" },
  };
  appendFileSync(b.path, JSON.stringify(meta) + "\n");
  const ids = [a.manager.getSessionId(), b.manager.getSessionId()];
  const preview = await previewSessionMerge(ids);
  assert.equal(preview.hasSubagent, true, "preview flags the subagent source");
  await assert.rejects(
    mergeSessions(ids),
    (error) => error instanceof SessionMergeError && error.code === "subagent",
  );
  assert.ok(existsSync(a.path) && existsSync(b.path), "refusal deletes nothing");
  // A forced cross-directory merge still refuses once subagent metadata is there.
  await assert.rejects(
    mergeSessions(ids, true, false),
    (error) => error instanceof SessionMergeError && error.code === "subagent",
  );
});
