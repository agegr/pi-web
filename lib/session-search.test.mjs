import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchSessionContents } from "./session-search.ts";

// Canonical definition: SIDE_BOUNDARY_MESSAGE_TYPE in lib/session-family.ts.
const SIDE_BOUNDARY_MESSAGE_TYPE = "pi-web:side-boundary";

function fixture(t, entries, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-search-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { id: "session", path, cwd: dir, created: "2026-01-01", modified: "2026-01-01", firstMessage: "first", messageCount: entries.length, ...overrides };
}

function message(role, content) {
  return { type: "message", message: { role, content } };
}

test("finds one literal, case-insensitive snippet per session, newest first", async (t) => {
  const older = fixture(t, [{ ...message("user", "before NEEDLE after"), id: "matched-entry" }, message("user", "needle again")], { id: "older" });
  const newer = fixture(t, [message("assistant", [{ type: "text", text: "another needle" }])], { id: "newer", modified: "2026-02-01" });
  const result = await searchSessionContents([older, newer], " needle ");
  assert.deepEqual(result.results.map(({ session }) => session.id), ["newer", "older"]);
  assert.deepEqual(result.results[1], { session: older, entryId: "matched-entry", blockIndex: 0, before: "before ", match: "NEEDLE", after: " after" });
  assert.equal(result.truncated, false);

  const literal = fixture(t, [message("user", "a".repeat(40) + "!"), message("user", "literal (a+)+$ and [test].*")]);
  assert.equal((await searchSessionContents([literal], "(a+)+$")).results[0].match, "(a+)+$");
  assert.equal((await searchSessionContents([literal], "[test].*")).results[0].match, "[test].*");
});

test("falls back to the displayed session title when no message matches", async (t) => {
  const renamed = fixture(t, [message("user", "unrelated body")], { id: "renamed", name: "Weekly Planning" });
  const generated = fixture(t, [message("user", "unrelated body")], { id: "generated", name: "Generated Project Summary" });
  const unnamed = fixture(t, [message("user", "unrelated body")], { id: "unnamed", firstMessage: "First Prompt Title" });

  const renamedResult = (await searchSessionContents([renamed], "planning")).results[0];
  assert.deepEqual(renamedResult, {
    session: renamed, blockIndex: 0, titleMatch: true,
    before: "Weekly ", match: "Planning", after: "", // no entryId: opening the session must not jump to a message
  });
  assert.equal((await searchSessionContents([generated], "project summary")).results[0].titleMatch, true);
  assert.equal((await searchSessionContents([unnamed], "prompt title")).results[0].titleMatch, true);
  assert.deepEqual((await searchSessionContents([renamed], "first prompt title")).results, []);
  const both = fixture(t, [{ ...message("user", "Weekly Planning in the body"), id: "body-entry" }], { name: "Weekly Planning" });
  const bodyResult = (await searchSessionContents([both], "planning")).results;
  assert.equal(bodyResult.length, 1);
  assert.equal(bodyResult[0].entryId, "body-entry");
  assert.equal(bodyResult[0].titleMatch, undefined);
  assert.equal((await searchSessionContents([both], "body")).results[0].entryId, "body-entry");
});

test("identifies the matching text block across thinking, tools and multiple text blocks", async (t) => {
  const session = fixture(t, [message("assistant", [
    { type: "thinking", thinking: "pi-cwd-spark" },
    { type: "text", text: "earlier text" },
    { type: "toolCall", name: "read", arguments: {} },
    { type: "text", text: "正文 pi-cwd-spark" },
    { type: "text", text: "later text" },
  ])]);
  assert.equal((await searchSessionContents([session], "pi-cwd-spark")).results[0].blockIndex, 3);
  assert.equal((await searchSessionContents([session], "earlier text")).results[0].blockIndex, 1);
  assert.equal((await searchSessionContents([session], "later text")).results[0].blockIndex, 4);
  assert.equal((await searchSessionContents([session], "spark\nlater")).results[0].blockIndex, 3);
});

test("searches historical text, excluding tools, thinking, images, summaries and transient sessions", async (t) => {
  const hidden = fixture(t, [
    message("toolResult", "needle"),
    message("assistant", [{ type: "thinking", thinking: "needle" }, { type: "toolCall", arguments: { text: "needle" } }, { type: "image", data: "needle" }]),
    { type: "compaction", summary: "needle" },
    { type: "custom", data: "needle" },
    message("user", null),
    null,
  ]);
  assert.deepEqual((await searchSessionContents([hidden], "needle")).results, []);
  const history = fixture(t, [message("user", "needle before compaction"), { type: "compaction", summary: "summary" }, message("user", "current")]);
  assert.equal((await searchSessionContents([history], "needle")).results.length, 1);
  assert.deepEqual((await searchSessionContents([{ ...history, transient: true }], "needle")).results, []);
});

test("keeps Unicode offsets correct and bounds snippets around the actual match", async (t) => {
  const session = fixture(t, [message("user", `${"x".repeat(200)}\n\u0130 中文 NEEDLE \n${"y".repeat(200)}`)]);
  const result = await searchSessionContents([session], "needle");
  assert.equal(result.results[0].match, "NEEDLE");
  assert.ok(result.results[0].before.startsWith("..."));
  assert.ok(result.results[0].after.endsWith("..."));
  assert.ok(result.results[0].before.length <= 83);
  assert.doesNotMatch(result.results[0].before, /\n/);
  assert.equal((await searchSessionContents([session], "中文")).results[0].match, "中文");
});

test("skips malformed lines and reports unreadable or oversized content as incomplete", async (t) => {
  const session = fixture(t, [message("user", "x".repeat(1024 * 1024 + 1)), message("user", "needle")]);
  const missing = { ...session, id: "missing", path: join(session.cwd, "missing.jsonl") };
  const result = await searchSessionContents([missing, session], "needle");
  assert.equal(result.results.length, 1);
  assert.equal(result.truncated, true);
  writeFileSync(session.path, `invalid\n${JSON.stringify(message("user", "needle"))}\n{"type":`);
  assert.equal((await searchSessionContents([session], "needle")).results.length, 1);
});

test("handles empty, oversized and cancelled queries without reading a session", async (t) => {
  const session = fixture(t, [message("user", "needle")]);
  assert.deepEqual(await searchSessionContents([session], "  "), { results: [], truncated: false });
  await assert.rejects(searchSessionContents([session], "x".repeat(201)), RangeError);
  assert.deepEqual(await searchSessionContents([session], "needle", AbortSignal.abort()), { results: [], truncated: true });
});

test("bounds bytes read from a single file and reports the unsearched remainder", async (t) => {
  const session = fixture(t, []);
  writeFileSync(session.path, " ".repeat(16 * 1024 * 1024) + "\n" + JSON.stringify(message("user", "needle")));
  assert.deepEqual(await searchSessionContents([session], "needle"), { results: [], truncated: true });
});

test("checks the deadline inside the final file, before the matching line", async (t) => {
  const session = fixture(t, [message("user", "no match"), message("user", "needle")]);
  let ticks = 0;
  t.mock.method(Date, "now", () => ++ticks <= 3 ? 0 : 4000);
  assert.deepEqual(await searchSessionContents([session], "needle"), { results: [], truncated: true });
});

test("reports file and result caps even when no conversations match", async (t) => {
  const session = fixture(t, [message("user", "needle")]);
  const sessions = Array.from({ length: 501 }, (_, index) => ({ ...session, id: String(index) }));
  const noMatches = await searchSessionContents(sessions, "absent");
  assert.deepEqual(noMatches, { results: [], truncated: true });
  const capped = await searchSessionContents(sessions, "needle");
  assert.equal(capped.results.length, 30);
  assert.equal(capped.truncated, true);
  assert.equal((await searchSessionContents(sessions.slice(0, 30), "needle")).truncated, false);
});

test("requires every space-separated term somewhere in the session, in any order", async (t) => {
  const apart = fixture(t, [{ ...message("user", "alpha appears first"), id: "first" }, { ...message("assistant", "then BETA later"), id: "second" }]);
  const result = (await searchSessionContents([apart], "alpha beta")).results[0];
  assert.equal(result.entryId, "first"); // the row shows the first term's first hit
  assert.equal(result.match, "alpha");
  assert.equal((await searchSessionContents([apart], "beta  alpha")).results[0].entryId, "second");
  assert.equal((await searchSessionContents([apart], "\talpha　beta ")).results.length, 1);
  assert.deepEqual((await searchSessionContents([apart], "alpha gamma")).results, []);
  // The first term's hit may come after the other terms'.
  assert.equal((await searchSessionContents([apart], "later alpha")).results[0].entryId, "second");

  const chinese = fixture(t, [message("user", "第一步是部署"), message("assistant", "第二步是上线")]);
  assert.equal((await searchSessionContents([chinese], "部署 上线")).results[0].match, "部署");
  assert.deepEqual((await searchSessionContents([chinese], "部署 回滚")).results, []);

  const many = fixture(t, [message("user", "a b c d"), message("user", "e f g h"), message("user", "i j k")]);
  assert.equal((await searchSessionContents([many], "a b c d e f g h i j k")).results.length, 1);
  assert.deepEqual((await searchSessionContents([many], "a b c d e f g h i j k l")).results, []);
});

test("keeps a quoted phrase together and every term literal", async (t) => {
  const session = fixture(t, [message("user", 'alpha comes before beta, then "alpha beta" and foo"bar with C++ foo(bar), an empty "" pair')]);
  const apart = fixture(t, [message("user", "alpha comes before beta")]);
  assert.equal((await searchSessionContents([session], '"alpha beta"')).results[0].match, "alpha beta");
  assert.deepEqual((await searchSessionContents([apart], '"alpha beta"')).results, []);
  assert.equal((await searchSessionContents([apart], '"alpha beta')).results.length, 0); // unclosed: reads to the end
  assert.equal((await searchSessionContents([apart], 'before "alpha')).results[0].match, "before");
  assert.equal((await searchSessionContents([session], 'foo"bar')).results[0].match, 'foo"bar');
  assert.equal((await searchSessionContents([session], 'C++ "" foo(bar)')).results[0].match, "C++");
  assert.equal((await searchSessionContents([session], '""')).results[0].match, '""');
  assert.deepEqual((await searchSessionContents([apart], "a.c")).results, []);
});

test("needs every term in the title for a title hit", async (t) => {
  const session = fixture(t, [message("user", "the body mentions planning")], { name: "Weekly Planning Notes" });
  assert.deepEqual((await searchSessionContents([session], "notes weekly")).results[0], {
    session, blockIndex: 0, titleMatch: true, before: "Weekly Planning ", match: "Notes", after: "",
  });
  assert.deepEqual((await searchSessionContents([session], "weekly body")).results, []);
});

test("still finds every session the whole query matched as one string", async (t) => {
  const words = ["alpha", "beta", "gamma", "delta", "echo"];
  let seed = 7;
  const pick = () => words[(seed = (seed * 48271) % 2147483647) % words.length];
  for (let round = 0; round < 50; round++) {
    const texts = Array.from({ length: 3 }, () => Array.from({ length: 4 }, pick).join(" "));
    const session = fixture(t, texts.map((text) => message("user", text)), { name: `${pick()} ${pick()}` });
    const query = `${pick()} ${pick()}`;
    if (![...texts, session.name].some((text) => text.includes(query))) continue;
    assert.equal((await searchSessionContents([session], query)).results.length, 1, `${query} in ${texts.join(" | ")}`);
  }
});

function sideBoundary(id = "side-boundary-1") {
  return { type: "custom_message", customType: SIDE_BOUNDARY_MESSAGE_TYPE, content: "boundary boilerplate zebraquilt", display: false, id, parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };
}

function sideSession(t, ownMessages, overrides = {}) {
  return fixture(t, [
    { type: "custom", customType: "pi-web:side", data: { version: 1, parentSessionId: "parent", createdAt: "2026-01-01T00:00:00.000Z" }, id: "side-meta-1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" },
    { ...message("user", "inherited parent words alphainherit"), id: "inherited" },
    sideBoundary(),
    ...ownMessages,
  ], { relation: { kind: "side", parentSessionId: "parent" }, ...overrides });
}

test("searches only what a side chat added after its boundary", async (t) => {
  const parent = fixture(t, [{ ...message("user", "inherited parent words alphainherit"), id: "parent-msg" }], { id: "parent" });
  const side = sideSession(t, [{ ...message("user", "side own words betaown"), id: "own-msg" }], { id: "side" });

  // Inherited text stays searchable in the parent, never again in the side chat.
  assert.deepEqual((await searchSessionContents([parent, side], "alphainherit")).results.map((r) => r.session.id), ["parent"]);
  // The side chat's own text is found, pointing at its own message.
  const own = await searchSessionContents([parent, side], "betaown");
  assert.deepEqual(own.results.map((r) => r.session.id), ["side"]);
  assert.equal(own.results[0].entryId, "own-msg");
  // One term inherited and one term own is no hit for either row.
  assert.deepEqual((await searchSessionContents([parent, side], "alphainherit betaown")).results, []);
  // The boundary boilerplate itself is never a hit.
  assert.deepEqual((await searchSessionContents([parent, side], "zebraquilt")).results, []);
});

test("a side chat's title fallback uses its own name, not the inherited first message", async (t) => {
  const parent = fixture(t, [message("user", "inherited parent words alphainherit")], { id: "parent" });
  const side = sideSession(t, [{ ...message("user", "something unrelated"), id: "own-msg" }],
    { id: "side", name: "Own Side Title", firstMessage: "inherited parent words alphainherit" });
  const ownTitle = await searchSessionContents([parent, side], "own side title");
  assert.equal(ownTitle.results.length, 1);
  assert.equal(ownTitle.results[0].titleMatch, true);
  assert.deepEqual((await searchSessionContents([parent, side], "alphainherit")).results.map((r) => r.session.id), ["parent"]);
});

test("a side chat without a boundary contributes nothing, not even its name", async (t) => {
  const parent = fixture(t, [{ ...message("user", "inherited parent words alphainherit"), id: "parent-msg" }], { id: "parent" });
  const broken = fixture(t, [{ ...message("user", "inherited parent words alphainherit"), id: "inherited" }],
    { id: "broken-side", name: "Cache sizing", relation: { kind: "side", parentSessionId: "parent" } });
  assert.deepEqual((await searchSessionContents([parent, broken], "alphainherit")).results.map((r) => r.session.id), ["parent"]);
  // Its own name cannot stand in for a body it never wrote.
  assert.deepEqual((await searchSessionContents([parent, broken], "cache sizing")).results, []);
});

test("an unnamed side chat's placeholder name is not searched", async (t) => {
  const parent = fixture(t, [message("user", "unrelated")], { id: "parent" });
  const side = sideSession(t, [message("user", "something unrelated")], { id: "side", name: "Side chat" });
  assert.deepEqual((await searchSessionContents([parent, side], "side chat")).results, []);
});

test("a side chat whose parent is gone is not returned", async (t) => {
  // The sidebar folds side chats into their parent's row; an orphan has none, so a
  // hit could not be opened.
  const orphan = sideSession(t, [message("user", "orphan own words gammaorphan")], { id: "orphan", relation: { kind: "side", parentSessionId: "gone" } });
  assert.deepEqual((await searchSessionContents([orphan], "gammaorphan")).results, []);
  const parent = fixture(t, [message("user", "unrelated")], { id: "parent" });
  const side = sideSession(t, [message("user", "orphan own words gammaorphan")], { id: "side" });
  assert.deepEqual((await searchSessionContents([parent, side], "gammaorphan")).results.map((r) => r.session.id), ["side"]);
});

test("an inherited line that only mentions the boundary type does not open the side chat's own part", async (t) => {
  // Lines before the boundary are skipped unparsed unless they hold the type's
  // text: pasted into a message, or in another extension's message, it must not
  // pass for the boundary and bring the inherited history in.
  const mention = `the marker is ${SIDE_BOUNDARY_MESSAGE_TYPE} deltamention`;
  const parent = fixture(t, [{ ...message("user", mention), id: "parent-msg" }], { id: "parent" });
  const side = fixture(t, [
    { type: "custom", customType: "pi-web:side", data: { version: 1, parentSessionId: "parent", createdAt: "2026-01-01T00:00:00.000Z" }, id: "side-meta-1", parentId: null },
    { ...message("user", mention), id: "inherited" },
    { type: "custom_message", customType: "other-extension", content: `${SIDE_BOUNDARY_MESSAGE_TYPE} deltamention`, display: true, id: "other" },
    { ...message("assistant", "inherited answer epsiloninherit"), id: "inherited-answer" },
    sideBoundary(),
    { ...message("user", "own words zetaown"), id: "own-msg" },
  ], { id: "side", relation: { kind: "side", parentSessionId: "parent" } });

  assert.deepEqual((await searchSessionContents([parent, side], "deltamention")).results.map((r) => r.session.id), ["parent"]);
  assert.deepEqual((await searchSessionContents([parent, side], "epsiloninherit")).results, []);
  const own = await searchSessionContents([parent, side], "zetaown");
  assert.deepEqual(own.results.map((r) => [r.session.id, r.entryId]), [["side", "own-msg"]]);
  assert.equal(own.truncated, false);
});

test("serves the same result from the cache as from a fresh read", async (t) => {
  const session = fixture(t, [
    { ...message("assistant", [{ type: "text", text: "filler" }, { type: "text", text: "alpha in the second block" }]), id: "entry-alpha" },
    message("user", "beta in another message"),
  ]);
  // A read that stops at a hit is never kept: the first message ends this scan, so
  // caching it would hide the second message from the next query. These run before any
  // other query, while nothing is cached yet.
  assert.equal((await searchSessionContents([session], "alpha")).results.length, 1);
  assert.equal((await searchSessionContents([session], "beta")).results.length, 1);

  const cold = await searchSessionContents([session], "alpha beta");
  assert.equal(cold.results.length, 1);
  assert.equal(cold.results[0].entryId, "entry-alpha");
  assert.equal(cold.results[0].blockIndex, 1);

  // Only a query with no hit fills the cache.
  assert.equal((await searchSessionContents([session], "absent")).results.length, 0);
  assert.deepEqual(await searchSessionContents([session], "alpha beta"), cold);
});

test("rereads a session after the file grows", async (t) => {
  const session = fixture(t, [message("user", "alpha first")]);
  await searchSessionContents([session], "absent");
  appendFileSync(session.path, `${JSON.stringify(message("user", "beta appended"))}\n`);
  const grown = await searchSessionContents([session], "beta appended");
  assert.deepEqual(grown.results.map(({ session: hit }) => hit.id), ["session"]);
});

test("caches nothing from a scan that skipped a line", async (t) => {
  // A line over MAX_LINE_CHARS is skipped and reported, so the scan is incomplete: a
  // later query must still report it rather than answer from a text that lacks the line.
  const session = fixture(t, [message("user", "alpha head")]);
  writeFileSync(session.path, "x".repeat(1024 * 1024 + 1) + "\n" + JSON.stringify(message("user", "beta tail")) + "\n");
  assert.equal((await searchSessionContents([session], "absent")).truncated, true);
  assert.equal((await searchSessionContents([session], "absent")).truncated, true);
  // The skipped line is not part of the text, but the message after it is still found.
  assert.deepEqual((await searchSessionContents([session], "beta tail")).results.map(({ session: hit }) => hit.id), ["session"]);
});

test("serves the cached text while size and mtime stay put", async (t) => {
  // The cache is keyed by path + size + mtime, so a rewrite that keeps both is the one
  // change it cannot see. That is the trade the key buys; this pins it down. Without
  // an exported cache-size probe, this is also the only black-box proof that a later
  // query reads the cache instead of the file.
  const session = fixture(t, [message("user", "alpha one")]);
  // A whole millisecond: a rewrite can restore it exactly, sub-millisecond stamps cannot.
  const stamp = 1_600_000_000.5;
  utimesSync(session.path, stamp, stamp);
  await searchSessionContents([session], "absent");
  writeFileSync(session.path, JSON.stringify(message("user", "alpha two")) + "\n");
  utimesSync(session.path, stamp, stamp);
  assert.equal((await searchSessionContents([session], "alpha one")).results.length, 1);
  assert.equal((await searchSessionContents([session], "alpha two")).results.length, 0);
  // The size alone does not decide: the same bytes with a newer mtime are re-read.
  utimesSync(session.path, stamp + 1, stamp + 1);
  assert.equal((await searchSessionContents([session], "alpha two")).results.length, 1);
});

test("keeps a side chat's boundary when the cached text is reused", async (t) => {
  const parent = fixture(t, [message("user", "inherited parent words alphainherit")], { id: "parent" });
  const side = sideSession(t, [{ ...message("user", "something unrelated"), id: "own-msg" }], { id: "side", name: "Own Side Title" });
  await searchSessionContents([parent, side], "absent");
  const title = await searchSessionContents([parent, side], "own side title");
  assert.deepEqual(title.results.map(({ session: hit }) => hit.id), ["side"]);

  // A side file whose boundary never arrives reports no title either, cached or not.
  const boundaryless = fixture(t, [message("user", "own body betaown")], {
    id: "boundaryless",
    name: "Boundaryless Title",
    relation: { kind: "side", parentSessionId: "parent" },
  });
  await searchSessionContents([parent, boundaryless], "absent");
  assert.deepEqual((await searchSessionContents([parent, boundaryless], "boundaryless title")).results, []);
});

test("reports a capped file the same way from the cache", async (t) => {
  // The tail past MAX_FILE_BYTES is never searched; caching must not turn that into
  // a complete answer, and a hit inside the cap must still not report truncation.
  // One-megabyte lines keep the file large without thousands of JSON reads; each stays
  // under MAX_LINE_CHARS, so the line the cap cuts is the only one skipped.
  const session = fixture(t, []);
  const padding = "x".repeat(1_000_000);
  const lines = [JSON.stringify(message("user", "alphacap at the head"))];
  while (lines.length < 18) lines.push(JSON.stringify(message("user", padding)));
  lines.push(JSON.stringify(message("user", "betacap past the cap")));
  writeFileSync(session.path, lines.join("\n") + "\n");

  assert.equal((await searchSessionContents([session], "absent")).truncated, true);
  assert.equal((await searchSessionContents([session], "absent")).truncated, true);
  const inside = await searchSessionContents([session], "alphacap");
  assert.equal(inside.results.length, 1);
  assert.equal(inside.truncated, false);
  const past = await searchSessionContents([session], "betacap");
  assert.deepEqual(past.results, []);
  assert.equal(past.truncated, true);
});

test("forgets a session the listing no longer shows", async (t) => {
  // pruneCache has no other black-box handle: the rewrite below keeps size and mtime,
  // so only a dropped entry lets the second query see the new text.
  const session = fixture(t, [message("user", "alpha one")]);
  const stamp = 1_600_000_000.5;
  utimesSync(session.path, stamp, stamp);
  await searchSessionContents([session], "absent");
  await searchSessionContents([], "absent");
  writeFileSync(session.path, JSON.stringify(message("user", "alpha two")) + "\n");
  utimesSync(session.path, stamp, stamp);
  assert.equal((await searchSessionContents([session], "alpha two")).results.length, 1);
});
