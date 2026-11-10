import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchSessionContents } from "./session-search.ts";

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
  assert.deepEqual(result.results[1], { session: older, entryId: "matched-entry", blockIndex: 0, before: "before ", match: "NEEDLE", after: " after", highlights: [{ start: 7, end: 13 }] });
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
    highlights: [{ start: 7, end: 15 }],
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

const snippetText = (result) => result.before + result.match + result.after;
const highlighted = (result) => {
  const text = snippetText(result);
  return result.highlights.map(({ start, end }) => text.slice(start, end));
};

test("requires every space-separated term anywhere in the session, in any order", async (t) => {
  const session = fixture(t, [
    { ...message("user", "alpha appears first"), id: "a" },
    { ...message("assistant", "then beta much later"), id: "b" },
  ]);
  // Terms may sit on different lines; the row stays anchored on the first term's
  // earliest hit and grows an excerpt for the term it does not contain.
  const reversed = (await searchSessionContents([session], "beta alpha")).results[0];
  assert.equal(reversed.entryId, "b");
  assert.equal(reversed.match, "beta");
  assert.deepEqual(highlighted(reversed), ["beta", "alpha"]);
  assert.match(snippetText(reversed), / … /);

  const forward = (await searchSessionContents([session], "alpha beta")).results[0];
  assert.equal(forward.entryId, "a");
  assert.equal(forward.match, "alpha");
  assert.deepEqual(highlighted(forward), ["alpha", "beta"]);

  assert.deepEqual((await searchSessionContents([session], "alpha gamma")).results, []);
  assert.equal((await searchSessionContents([session], "alpha   beta")).results.length, 1);
});

test("highlights every term in the snippet, not just the first", async (t) => {
  const session = fixture(t, [message("user", "alpha then beta in one line")], { id: "both" });
  const hit = (await searchSessionContents([session], "beta alpha")).results[0];
  assert.deepEqual(hit, {
    session, blockIndex: 0,
    before: "alpha then ", match: "beta", after: " in one line",
    highlights: [{ start: 0, end: 5 }, { start: 11, end: 15 }],
  });
  // Ranges are offsets into before + match + after, so the client can paint them directly.
  const text = hit.before + hit.match + hit.after;
  assert.deepEqual(hit.highlights.map(({ start, end }) => text.slice(start, end)), ["alpha", "beta"]);

  // Overlapping terms paint one mark, not two.
  const overlapping = (await searchSessionContents([session], "alp alpha")).results[0];
  assert.deepEqual(overlapping.highlights, [{ start: 0, end: 5 }]);
});

test("widens the snippet so nearby terms of one message are both marked", async (t) => {
  const near = fixture(t, [message("user", `alpha ${"x".repeat(50)} beta tail`)], { id: "near" });
  const hit = (await searchSessionContents([near], "alpha beta")).results[0];
  const text = snippetText(hit);
  assert.deepEqual(highlighted(hit), ["alpha", "beta"]);
  assert.ok(text.length <= 200);

  // Too far apart in one message: the anchor keeps its own window and the second
  // term arrives as its own excerpt, so both are still marked.
  const far = fixture(t, [message("user", `alpha ${"y".repeat(300)} beta`)], { id: "far" });
  const farHit = (await searchSessionContents([far], "alpha beta")).results[0];
  assert.deepEqual(highlighted(farHit), ["alpha", "beta"]);
  assert.match(snippetText(farHit), / … /);
  assert.ok(snippetText(farHit).length <= 200);
});

test("keeps quoted phrases exact and mixes them with single terms", async (t) => {
  const apart = fixture(t, [message("user", "alpha and beta are apart")], { id: "apart" });
  assert.deepEqual((await searchSessionContents([apart], '"alpha beta"')).results, []);

  const pair = fixture(t, [message("user", "an alpha beta pair")], { id: "pair" });
  assert.equal((await searchSessionContents([pair], '"alpha beta"')).results[0].match, "alpha beta");

  const mixed = fixture(t, [message("user", "gamma has an alpha beta pair")], { id: "mixed" });
  assert.equal((await searchSessionContents([mixed], 'gamma "alpha beta"')).results.length, 1);
  assert.equal((await searchSessionContents([mixed], '"alpha beta" gamma')).results.length, 1);
  assert.equal((await searchSessionContents([mixed], '"alpha beta"')).results[0].match, "alpha beta");
  // An unclosed quote is treated as a term instead of dropping the query.
  assert.equal((await searchSessionContents([mixed], '"alpha')).results.length, 1);
  // An empty phrase matches nothing rather than throwing.
  assert.deepEqual((await searchSessionContents([mixed], '""')), { results: [], truncated: false });
});

test("keeps quotes inside a word literal so literal queries still match", async (t) => {
  const session = fixture(t, [message("user", 'the foo"bar token and a lone " quote')], { id: "quotes" });
  // The old behaviour searched the whole query literally, so this must still hit.
  assert.equal((await searchSessionContents([session], 'foo"bar')).results.length, 1);
  assert.equal((await searchSessionContents([session], 'lone " quote')).results.length, 1);

  const plain = fixture(t, [message("user", "alpha beta gamma")], { id: "plain" });
  assert.equal((await searchSessionContents([plain], '"alpha beta" gamma')).results.length, 1);
  assert.deepEqual((await searchSessionContents([plain], '"alpha beta" delta')).results, []);
  // An opening quote with nothing after it has no term to look for.
  assert.deepEqual(await searchSessionContents([plain], '"'), { results: [], truncated: false });
  assert.deepEqual(await searchSessionContents([plain], '""'), { results: [], truncated: false });
});

test("keeps the historical 80-character margins for a single term", async (t) => {
  const text = `${"a".repeat(120)} needle ${"b".repeat(120)}`;
  const session = fixture(t, [message("user", text)]);
  const hit = (await searchSessionContents([session], "needle")).results[0];
  // 80 characters each side plus the "..." markers: a one-term query must not
  // silently get a narrower window than it had before.
  assert.equal(hit.before.length, 83);
  assert.equal(hit.after.length, 83);
});

test("bounds the snippet even when a term is longer than the margin budget", async (t) => {
  const long = "x".repeat(150);
  const session = fixture(t, [message("user", `${"y".repeat(50)} ${long} ${"z".repeat(50)}`)]);
  const hit = (await searchSessionContents([session], long)).results[0];
  assert.ok(snippetText(hit).length <= 200, `snippet was ${snippetText(hit).length}`);
});

test("never splits a surrogate pair at a snippet boundary", async (t) => {
  const session = fixture(t, [message("user", `${"🔥".repeat(120)} needle`)]);
  const hit = (await searchSessionContents([session], "needle")).results[0];
  const text = snippetText(hit);
  assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  assert.doesNotMatch(text, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});

test("still marks later terms when an earlier excerpt does not fit", async (t) => {
  const session = fixture(t, [
    { ...message("user", `${"x".repeat(100)} alpha ${"y".repeat(100)}`), id: "a" },
    { ...message("assistant", `${"p".repeat(60)} beta ${"q".repeat(60)}`), id: "b" },
    { ...message("user", "gamma"), id: "c" },
  ]);
  const hit = (await searchSessionContents([session], "alpha beta gamma")).results[0];
  const marks = highlighted(hit);
  const text = snippetText(hit);
  assert.ok(marks.includes("alpha"), `marks: ${JSON.stringify(marks)}`);
  // beta's excerpt cannot fit; that must not hide gamma behind it.
  assert.ok(marks.includes("gamma"), `marks: ${JSON.stringify(marks)}`);
  assert.ok(text.length <= 200, `snippet was ${text.length}`);
  // No "... …" double ellipsis at the join.
  assert.doesNotMatch(text, /\.\.\. … /);
});

test("keeps regex metacharacters literal in every term", async (t) => {
  const session = fixture(t, [message("user", "C++ with std::vector and foo(bar) and (a+)+$")]);
  assert.equal((await searchSessionContents([session], "C++ std::vector")).results[0].match, "C++");
  assert.equal((await searchSessionContents([session], "foo(bar)")).results[0].match, "foo(bar)");
  assert.equal((await searchSessionContents([session], "(a+)+$")).results[0].match, "(a+)+$");
  assert.deepEqual((await searchSessionContents([session], "C++ Rust")).results, []);
});

test("applies the AND rule to the title fallback too", async (t) => {
  const session = fixture(t, [message("user", "body mentions planning")], { name: "Weekly Planning" });
  const titleHit = (await searchSessionContents([session], "weekly planning")).results[0];
  assert.equal(titleHit.titleMatch, true);
  assert.equal(titleHit.match, "Weekly");
  // One term in the body and one in the title is still not a match: a partial
  // snippet would highlight only half of what the user asked for.
  assert.deepEqual((await searchSessionContents([session], "weekly body")).results, []);
});

test("searches a query of only quotes literally instead of returning nothing", async (t) => {
  const session = fixture(t, [message("user", 'he said "" and left')]);
  // Parsing yields no term; the whole string becomes one literal term, which is the
  // behaviour this change must not narrow.
  assert.equal((await searchSessionContents([session], '""')).results.length, 1);
  assert.equal((await searchSessionContents([session], '"')).results[0].match, '"');
});

test("falls back to the whole query literally when it parses to too many terms", async (t) => {
  const literal = "alpha beta gamma delta epsilon zeta eta theta iota";
  const session = fixture(t, [message("user", `x ${literal} y`)]);
  assert.equal((await searchSessionContents([session], literal)).results.length, 1);
  // Nine scattered single letters used to be a nine-way AND; past the limit the query
  // is searched verbatim instead, which keeps the per-message work linear.
  const scattered = fixture(t, [message("user", "a"), message("user", "b"), message("user", "c")]);
  assert.deepEqual((await searchSessionContents([scattered], "a b c d e f g h i")).results, []);
});

test("keeps every term of a multi-word query visible when they sit in different messages", async (t) => {
  const filler = "filler text ".repeat(200);
  const session = fixture(t, [
    message("user", `${filler} needle alpha ${filler}`),
    message("assistant", filler),
    message("assistant", `${filler} needle beta ${filler}`),
  ]);
  const result = (await searchSessionContents([session], "alpha beta")).results[0];
  const text = result.before + result.match + result.after;
  assert.ok(text.includes("alpha"), `alpha missing: ${JSON.stringify(text.slice(-60))}`);
  assert.ok(text.includes("beta"), `beta missing: ${JSON.stringify(text.slice(-60))}`);
  assert.ok(text.length <= 200, `snippet was ${text.length}`);
  assert.equal(result.highlights.length, 2);
  // The separator already marks the gap; no "... …" double ellipsis on either side.
  assert.doesNotMatch(text, /\.\.\. \u2026/);
  assert.doesNotMatch(text, /\u2026 \.\.\./);
});

test("counts terms that no longer fit instead of dropping them silently", async (t) => {
  const filler = "filler text ".repeat(200);
  const entries = [1, 2, 3, 4, 5, 6].map((n) => message("user", `${filler} t${n} ${filler}`));
  const session = fixture(t, entries);
  const result = (await searchSessionContents([session], "t1 t2 t3 t4 t5 t6")).results[0];
  const text = result.before + result.match + result.after;
  assert.ok(text.length <= 200, `snippet was ${text.length}`);
  assert.match(text, /\(\+\d\)/);
});
