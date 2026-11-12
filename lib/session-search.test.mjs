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
