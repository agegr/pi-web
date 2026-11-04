import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const {
  flushSessionScanIndexForTests,
  listSessionsIncremental,
  resetSessionScanIndexForTests,
  scanSessionFileInfo,
} = await jiti.import("./session-list-scanner.ts");
const { listAllSessions, invalidateSessionListCache } = await jiti.import("./session-reader.ts");
const timestamp = "2026-01-01T00:00:00.000Z";
// Every read stream a scan opens and where it starts: a full scan reads from
// byte 0, a resumed one from where the previous scan stopped. Mocked before the
// first scan: through jiti the scanner keeps the function its first call found.
const reads = [];
const createReadStream = fs.createReadStream;
mock.method(fs, "createReadStream", (path, options, ...rest) => {
  reads.push({ path, start: options?.start ?? 0 });
  return createReadStream(path, options, ...rest);
});
syncBuiltinESMExports();
const line = (entry) => JSON.stringify(entry) + "\n";
const message = (id, role, content, time = timestamp) => ({
  type: "message", id, parentId: null, timestamp: time, message: { role, content },
});

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-scanner-"));
  const dir = join(root, "sessions", "project");
  fs.mkdirSync(dir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  t.after(() => {
    resetSessionScanIndexForTests();
    invalidateSessionListCache();
    globalThis.__piSessionPathCache = undefined;
    globalThis.__piPathToSessionIdCache = undefined;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(id, entries = [], extraHeader = {}) {
    const path = join(dir, `${id}.jsonl`);
    fs.writeFileSync(path, line({ type: "session", version: 3, id, cwd: root, timestamp, ...extraHeader }) + entries.map(line).join(""));
    return path;
  }
  return { root, dir, write, indexPath: join(root, "pi-web-session-index.json") };
}

async function sdkMetadata() {
  return (await SessionManager.listAll()).map((session) => {
    const info = { ...session };
    delete info.allMessagesText;
    return info;
  });
}

/** The scanner's own additions beside the SDK's metadata, which it follows. */
function withoutScanExtras(sessions) {
  return sessions.map((session) => {
    const info = { ...session };
    delete info.lastReplyStopReason;
    return info;
  });
}

test("matches SDK metadata and tie ordering across cache hits, mutations, and restarts", async (t) => {
  const { write, indexPath } = fixture(t);
  const a = write("a", [
    message("a1", "user", [{ type: "image", data: "ignored", mimeType: "image/png" }, { type: "text", text: "first" }, { type: "text", text: "request" }]),
    message("a2", "assistant", [{ type: "text", text: "answer" }]),
    message("a3", "toolResult", [{ type: "text", text: "output" }], "2026-01-03T00:00:00.000Z"),
    { type: "custom", data: "x".repeat(256 * 1024) },
  ]);
  const b = write("b", [message("b1", "user", "forked request")], { parentSession: a });
  const c = write("c");
  async function check(label, expectedReads) {
    const expected = await sdkMetadata();
    reads.length = 0;
    assert.deepEqual(withoutScanExtras(await listSessionsIncremental()), expected, label);
    assert.deepEqual(reads.map((read) => read.path).sort(), [...expectedReads].sort(), `${label}: scanned files`);
    // A restart below finds what a long-lived process would have written.
    flushSessionScanIndexForTests();
  }

  await check("cold", [a, b, c]);
  await check("warm", []);
  if (process.platform !== "win32") assert.equal(fs.statSync(indexPath).mode & 0o777, 0o600);
  resetSessionScanIndexForTests();
  await check("persisted cache", []);

  fs.appendFileSync(a, line({ type: "session_info", name: "  Renamed  " }));
  await check("rename preserves equal-time order", [a]);
  fs.appendFileSync(a, line({ type: "session_info", name: " " }));
  await check("explicit name clear", [a]);
  fs.appendFileSync(b, line(message("b2", "assistant", "new activity", "2026-01-02T00:00:00.000Z")));
  await check("append", [b]);
  write("a", [message("replacement", "user", "rewritten")]);
  await check("whole-file rewrite", [a]);
  const d = write("d", [message("d1", "user", "new session")]);
  fs.rmSync(c);
  await check("create and delete", [d]);

  resetSessionScanIndexForTests();
  fs.appendFileSync(a, line({ type: "session_info", name: "changed while stopped" }));
  fs.rmSync(b);
  await check("restart revalidates changed and deleted files", [a]);
  const persisted = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.deepEqual(Object.keys(persisted.entries).sort(), [a, d].sort());
});

test("discards malformed persisted entries and rebuilds the list from valid session files", async (t) => {
  const { write, indexPath } = fixture(t);
  const a = write("a", [message("a1", "user", "healthy")]);
  write("b", [message("b1", "user", "also healthy")]);
  const expected = await listSessionsIncremental();
  flushSessionScanIndexForTests();
  const pristine = fs.readFileSync(indexPath, "utf8");
  const corruptions = [
    ["missing fingerprint", (entry) => { delete entry.fp; }],
    ["null fingerprint", (entry) => { entry.fp = null; }],
    ["string size", (entry) => { entry.fp.size = String(entry.fp.size); }],
    ["negative size", (entry) => { entry.fp.size = -1; }],
    ["invalid mtime", (entry) => { entry.fp.mtimeMs = null; }],
    ["missing metadata", (entry) => { delete entry.info; }],
    ["mismatched path", (entry) => { entry.info.path = "/elsewhere/session.jsonl"; }],
    ["invalid id", (entry) => { entry.info.id = null; }],
    ["invalid cwd", (entry) => { entry.info.cwd = []; }],
    ["invalid first message", (entry) => { entry.info.firstMessage = 1; }],
    ["invalid name", (entry) => { entry.info.name = {}; }],
    ["invalid parent", (entry) => { entry.info.parentSessionPath = []; }],
    ["invalid count", (entry) => { entry.info.messageCount = -1; }],
    ["invalid created", (entry) => { entry.info.created = "not a date"; }],
    ["invalid modified", (entry) => { entry.info.modified = "not a date"; }],
    ["null date", (entry) => { entry.info.created = null; }],
    ["malformed resume point", (entry) => { entry.resume.offset = "12"; }],
    ["resume point inside the header", (entry) => { entry.resume.headerEnd = entry.resume.offset + 1; }],
    ["resume point without an inode", (entry) => { delete entry.resume.ino; }],
  ];
  for (const [label, corrupt] of corruptions) {
    const index = JSON.parse(pristine);
    corrupt(index.entries[a]);
    fs.writeFileSync(indexPath, JSON.stringify(index));
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, label);
    const sessions = await listAllSessions({ force: true });
    assert.deepEqual(sessions.map((s) => s.id), expected.map((s) => s.id), label);
    flushSessionScanIndexForTests();
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, `${label}: repaired cache survives restart`);
  }
  for (const source of ["{", "null", '{"version":2,"entries":{}}', '{"version":1,"entries":[]}', '{"version":1,"entries":{"broken":null}}']) {
    fs.writeFileSync(indexPath, source);
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, source);
  }
});

test("retains SDK handling of partial lines, activity timestamps, and empty sessions", async (t) => {
  const { dir, write } = fixture(t);
  const a = write("a", [
    message("a1", "assistant", "not the first user message"),
    message("a2", "user", []),
    { ...message("a3", "user", "user message"), message: { role: "user", content: "user message", timestamp: Date.parse("2026-01-04T00:00:00.000Z") } },
  ]);
  fs.appendFileSync(a, '{"unfinished":');
  const b = write("b");
  fs.writeFileSync(b, "\nnot json\n" + fs.readFileSync(b, "utf8"));
  fs.writeFileSync(join(dir, "invalid.jsonl"), line(message("invalid", "user", "no header")));
  assert.deepEqual(withoutScanExtras(await listSessionsIncremental()), await sdkMetadata());
});

// What a scan from byte 0 lists for one file; call it before resetting `reads`.
async function fullScan(path) {
  const info = await scanSessionFileInfo(path);
  return info ? [info] : [];
}

test("a file that only grew is parsed from where the last scan stopped", async (t) => {
  const { write } = fixture(t);
  const a = write("a", [message("a1", "assistant", "an assistant-only start", "2026-01-02T00:00:00.000Z")]);
  assert.deepEqual(withoutScanExtras(await listSessionsIncremental()), await sdkMetadata());

  async function appendAndCheck(label, text, { resumed = true } = {}) {
    const offset = fs.statSync(a).size;
    fs.appendFileSync(a, text);
    const expected = await fullScan(a);
    reads.length = 0;
    const listed = await listSessionsIncremental();
    assert.deepEqual(listed, expected, label);
    if (resumed) {
      assert.equal(reads.length, 1, `${label}: one read`);
      assert.ok(reads[0].start > 0 && reads[0].start <= offset, `${label}: resumed at ${reads[0].start}`);
    } else {
      assert.deepEqual(reads, [{ path: a, start: 0 }], `${label}: full scan`);
    }
    return listed[0];
  }

  let row = await appendAndCheck("message", line(message("a2", "assistant", "more", "2026-01-03T00:00:00.000Z")));
  assert.equal(row.messageCount, 2);
  assert.equal(row.firstMessage, "(no messages)");
  row = await appendAndCheck("rename", line({ type: "session_info", name: "  Renamed  " }));
  assert.equal(row.name, "Renamed");
  row = await appendAndCheck("first user message after an assistant-only start", line(message("a3", "user", [{ type: "text", text: "the" }, { type: "text", text: "question" }])));
  assert.equal(row.firstMessage, "the question");
  row = await appendAndCheck("a later user message keeps the first", line(message("a4", "user", "later question", "2026-01-05T00:00:00.000Z")));
  assert.equal(row.firstMessage, "the question");
  assert.equal(row.modified.toISOString(), "2026-01-05T00:00:00.000Z");
  row = await appendAndCheck("name cleared", line({ type: "session_info", name: " " }));
  assert.equal(row.name, undefined);

  // A writer midway through a line: the listing counts what readline would,
  // and the next scan starts from the line's beginning again.
  const half = line(message("a5", "assistant", "half written", "2026-01-06T00:00:00.000Z"));
  const before = fs.statSync(a).size;
  row = await appendAndCheck("partial line", half.slice(0, 40));
  assert.equal(row.messageCount, 4);
  row = await appendAndCheck("partial line completed", half.slice(40));
  assert.equal(reads[0].start, before, "the completed line is read from its start");
  assert.equal(row.messageCount, 5);

  // A complete entry without its newline counts now; with no resume point kept,
  // the newline pi appends when it opens the file costs one full scan.
  row = await appendAndCheck("entry without newline", JSON.stringify(message("a6", "assistant", "no newline yet")));
  assert.equal(row.messageCount, 6);
  await appendAndCheck("its newline", "\n", { resumed: false });
  await appendAndCheck("resumes after that full scan", line(message("a7", "assistant", "again")));

  // The resume point is persisted with the row.
  flushSessionScanIndexForTests();
  resetSessionScanIndexForTests();
  row = await appendAndCheck("after a restart", line(message("a8", "user", "after restart")));
  assert.equal(row.messageCount, 8);
  assert.deepEqual(withoutScanExtras(await listSessionsIncremental()), await sdkMetadata(), "matches the SDK");
});

test("a resumed scan splits CRLF and lone CR line ends as readline does", async (t) => {
  const { dir } = fixture(t);
  const path = join(dir, "crlf.jsonl");
  const crlf = (entry) => JSON.stringify(entry) + "\r\n";
  fs.writeFileSync(path, crlf({ type: "session", version: 3, id: "crlf", cwd: dir, timestamp }) + crlf(message("c1", "user", "windows")));
  await listSessionsIncremental();
  fs.appendFileSync(path, JSON.stringify(message("c2", "assistant", "reply")) + "\r" + crlf({ type: "session_info", name: "CR" }));
  const expected = await fullScan(path);
  reads.length = 0;
  assert.deepEqual(await listSessionsIncremental(), expected);
  assert.ok(reads[0].start > 0, "resumed");
  assert.equal(expected[0].messageCount, 2);
  assert.equal(expected[0].name, "CR");
});

test("a rewrite in place or a truncation falls back to a full scan", async (t) => {
  const { write } = fixture(t);
  const entries = [message("r1", "user", "original question"), message("r2", "assistant", "original answer")];
  const a = write("a", entries);
  async function rewriteAndCheck(label, rewrite) {
    await listSessionsIncremental();
    const before = fs.statSync(a);
    rewrite();
    // A distinct mtime, so even a same-size rewrite changes the fingerprint.
    const later = new Date(before.mtimeMs + 60_000);
    fs.utimesSync(a, later, later);
    const expected = await fullScan(a);
    reads.length = 0;
    assert.deepEqual(await listSessionsIncremental(), expected, label);
    assert.deepEqual(reads, [{ path: a, start: 0 }], `${label}: full scan`);
    return { row: expected[0], grew: fs.statSync(a).size - before.size };
  }

  let result = await rewriteAndCheck("same size", () => write("a", [message("r1", "user", "replaced question"), entries[1]]));
  assert.equal(result.grew, 0);
  assert.equal(result.row.firstMessage, "replaced question");
  result = await rewriteAndCheck("larger, header changed", () => {
    write("a", [...entries, message("r3", "assistant", "appended")], { parentSession: "/elsewhere/parent.jsonl" });
  });
  assert.ok(result.grew > 0);
  assert.equal(result.row.parentSessionPath, "/elsewhere/parent.jsonl");
  result = await rewriteAndCheck("larger, last line changed", () => {
    write("a", [entries[0], message("r2", "assistant", "a longer rewritten answer"), message("r3", "assistant", "appended"), message("r4", "assistant", "appended")], { parentSession: "/elsewhere/parent.jsonl" });
  });
  assert.ok(result.grew > 0);
  assert.equal(result.row.messageCount, 4);
  result = await rewriteAndCheck("truncated", () => write("a", [entries[0]]));
  assert.ok(result.grew < 0);
  assert.equal(result.row.messageCount, 1);
});

test("a file replaced by a rename is read in full, even when its sampled bytes match", async (t) => {
  const { dir, write } = fixture(t);
  const a = write("a", [message("k1", "user", "deploy with key sk-live-1234567890"), message("k2", "assistant", "r".repeat(2048))]);
  await listSessionsIncremental();
  // sed -i: the same-length edit is written to a new file renamed over the old.
  const temp = join(dir, ".a.tmp");
  fs.writeFileSync(temp, fs.readFileSync(a, "utf8").replace("sk-live-1234567890", "*".repeat(18)));
  fs.renameSync(temp, a);
  fs.appendFileSync(a, line(message("k3", "assistant", "done")));
  const expected = await fullScan(a);
  reads.length = 0;
  const listed = await listSessionsIncremental();
  assert.deepEqual(listed, expected);
  assert.equal(listed[0].firstMessage, `deploy with key ${"*".repeat(18)}`);
  assert.deepEqual(reads, [{ path: a, start: 0 }], "full scan");
});

// SessionManager.listAll() reads lines with readline, which splits on these on
// Node 24 (not on 22); the session pi opens is read by its loader, split on \n.
test("a raw U+2028 or U+2029 stays inside its line, as pi's loader reads it", async (t) => {
  const { write } = fixture(t);
  const loaded = (path) => {
    const session = SessionManager.open(path);
    const messages = session.getEntries().filter((entry) => entry.type === "message");
    return { messageCount: messages.length, firstMessage: messages[0]?.message.content, name: session.getSessionName() };
  };
  const text = "first\u2028second";
  const a = write("a", [message("u1", "user", text)]);
  assert.ok(fs.readFileSync(a, "utf8").includes("\u2028"), "JSON.stringify leaves it raw");
  let [row] = await listSessionsIncremental();
  assert.deepEqual(loaded(a), { messageCount: 1, firstMessage: text, name: undefined });
  assert.equal(row.messageCount, 1);
  assert.equal(row.firstMessage, text);

  fs.appendFileSync(a, line({ type: "session_info", name: "named\u2029here" }));
  reads.length = 0;
  [row] = await listSessionsIncremental();
  assert.ok(reads[0].start > 0, "resumed");
  assert.deepEqual([row], await fullScan(a));
  assert.equal(row.name, "named\u2029here");
  assert.equal(loaded(a).name, row.name);
});

test("a queued index write goes to the agent dir whose scan queued it", async (t) => {
  const { write, indexPath } = fixture(t);
  const other = fs.mkdtempSync(join(tmpdir(), "pi-web-scanner-other-"));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  fs.mkdirSync(join(other, "sessions", "project"), { recursive: true });
  const otherIndex = join(other, "pi-web-session-index.json");
  const a = write("a", [message("a1", "user", "question")]);
  const agentDir = process.env.PI_CODING_AGENT_DIR;

  await listSessionsIncremental();
  process.env.PI_CODING_AGENT_DIR = other;
  flushSessionScanIndexForTests();
  assert.equal(fs.existsSync(otherIndex), false, "nothing written to the dir switched to");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(indexPath, "utf8")).entries), [a]);

  // A scan of another dir sends the pending write to its own dir first.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.appendFileSync(a, line(message("a2", "assistant", "answer")));
  await listSessionsIncremental();
  process.env.PI_CODING_AGENT_DIR = other;
  const b = join(other, "sessions", "project", "b.jsonl");
  fs.writeFileSync(b, line({ type: "session", version: 3, id: "b", cwd: other, timestamp }) + line(message("b1", "user", "other")));
  await listSessionsIncremental();
  const written = JSON.parse(fs.readFileSync(indexPath, "utf8")).entries;
  assert.deepEqual(Object.keys(written), [a]);
  assert.equal(written[a].info.messageCount, 2);
  flushSessionScanIndexForTests();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(otherIndex, "utf8")).entries), [b]);
});

test("index writes trail the scans that change it", async (t) => {
  const { write, indexPath } = fixture(t);
  const a = write("a", [message("a1", "user", "question")]);
  await listSessionsIncremental();
  assert.equal(fs.existsSync(indexPath), false, "not written by the scan itself");
  flushSessionScanIndexForTests();
  const first = fs.readFileSync(indexPath, "utf8");
  assert.equal(JSON.parse(first).entries[a].info.messageCount, 1);
  fs.appendFileSync(a, line(message("a2", "assistant", "answer")));
  await listSessionsIncremental();
  fs.appendFileSync(a, line(message("a3", "assistant", "more")));
  await listSessionsIncremental();
  assert.equal(fs.readFileSync(indexPath, "utf8"), first, "two rescans, no write yet");
  flushSessionScanIndexForTests();
  assert.equal(JSON.parse(fs.readFileSync(indexPath, "utf8")).entries[a].info.messageCount, 3);
});

test("defers changed-file details to a later scan", async (t) => {
  const { write } = fixture(t);
  const sessionPath = write("deferred", [
    message("d1", "user", "deferred request"),
    message("d2", "assistant", "deferred answer"),
  ]);

  // A summary listing reads only the header and stat, so the transcript-derived
  // fields stay empty and the row is marked as pending.
  const summary = await listSessionsIncremental({ deferDetails: true });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].path, sessionPath);
  assert.equal(summary[0].detailsPending, true);
  assert.equal(summary[0].messageCount, 0);
  assert.equal(summary[0].firstMessage, "");
  assert.equal(summary[0].id, "deferred");
  assert.equal(summary[0].cwd, process.env.PI_CODING_AGENT_DIR);

  // The normal listing still hydrates the exact details.
  const detailed = await listSessionsIncremental();
  assert.equal(detailed[0].detailsPending, undefined);
  assert.equal(detailed[0].messageCount, 2);
  assert.equal(detailed[0].firstMessage, "deferred request");
});

test("a summary listing does not downgrade an already-scanned file", async (t) => {
  const { write } = fixture(t);
  write("cached", [message("c1", "user", "cached request")]);

  const detailed = await listSessionsIncremental();
  assert.equal(detailed[0].messageCount, 1);

  // The cached entry is complete, so the summary listing serves it as-is. The
  // scan index is persisted across restarts, so this is the common path: a
  // first paint should not blank details it is already holding.
  const summary = await listSessionsIncremental({ deferDetails: true });
  assert.equal(summary[0].detailsPending, undefined);
  assert.equal(summary[0].messageCount, 1);
  assert.equal(summary[0].firstMessage, "cached request");
  assert.equal((await listSessionsIncremental())[0].messageCount, 1);
});

test("a summary listing defers only the files the index has not scanned", async (t) => {
  const { write } = fixture(t);
  write("cached", [message("c1", "user", "cached request")]);
  assert.equal((await listSessionsIncremental())[0].messageCount, 1);

  // A file the index has never seen has no details to reuse, so it is the one
  // row that comes back pending — the point of the summary mode.
  write("fresh", [message("f1", "user", "fresh request")]);
  const summary = await listSessionsIncremental({ deferDetails: true });
  const byId = Object.fromEntries(summary.map((row) => [row.id, row]));
  assert.equal(byId.cached.detailsPending, undefined);
  assert.equal(byId.cached.messageCount, 1);
  assert.equal(byId.fresh.detailsPending, true);
  assert.equal(byId.fresh.messageCount, 0);
});

test("discovers sessions through project directory symlinks", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir, write } = fixture(t);
  write("a", [message("a1", "user", "linked")]);
  const external = join(root, "external-project");
  fs.renameSync(dir, external);
  fs.symlinkSync(external, dir, "dir");
  assert.deepEqual(withoutScanExtras(await listSessionsIncremental()), await sdkMetadata());
});

test("the last assistant reply's stop reason follows appends, resumed or not", async (t) => {
  const { write } = fixture(t);
  const path = write("a", [
    message("a1", "user", "run it"),
    { ...message("a2", "assistant", "overloaded"), message: { role: "assistant", content: [], stopReason: "error" } },
  ]);
  const scan = async () => (await listSessionsIncremental()).find((session) => session.id === "a");
  assert.equal((await scan()).lastReplyStopReason, "error", "a failed reply is what the filter reads");
  assert.equal((await listAllSessions({ force: true })).find((session) => session.id === "a").lastReplyFailed, true);

  // A resumed scan continues the running total, not just the new lines.
  reads.length = 0;
  fs.appendFileSync(path, line({ ...message("a3", "assistant", "here"), message: { role: "assistant", content: [], stopReason: "stop" } }));
  assert.equal((await scan()).lastReplyStopReason, "stop", "a later answer clears the failure");
  assert.ok(reads.some((read) => read.start > 0), "the append was read from the resume point");
  assert.equal((await listAllSessions({ force: true })).find((session) => session.id === "a").lastReplyFailed, undefined);
});
