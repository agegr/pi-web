// Tests for lib/session-search.ts — the sidebar's session search.
//
// Written against the behaviour contract in docs/agents/sessions.md
// ("Session search terms"), not against the implementation: every case here is
// about what a user typing in the search field gets back (which sessions match,
// what one row shows, which parts of it are marked), so grouping follows those
// questions rather than the module's internals. Highlight offsets are the one
// implementation-facing detail asserted, because they are the payload the row's
// snippet component paints.
//
// Nothing here reads ~/.pi or the clock: sessions are JSONL files written into a
// per-test temporary directory, so results are identical on every run.
//
// Run:
//   $env:NODE_ENV="development"
//   node --experimental-strip-types --test lib/session-search.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { searchSessionContents } from "./session-search.ts";

/** Writes `entries` (objects are JSON-stringified one per line) as one session file. */
function writeSession(t, entries, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-search-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  writeFileSync(
    path,
    entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join("\n") + "\n",
  );
  return {
    id: "session",
    path,
    cwd: dir,
    created: "2026-01-01",
    modified: "2026-01-01",
    firstMessage: "first",
    messageCount: entries.length,
    ...overrides,
  };
}

/** A user/assistant message entry; `content` may be a string or a block array. */
function message(role, content) {
  return { type: "message", message: { role, content } };
}

const search = (sessions, query, signal) => searchSessionContents(sessions, query, signal);
const one = async (sessions, query) => (await search(sessions, query)).results[0];

const snippetText = (result) => result.before + result.match + result.after;
/** The row's text without the trailing " … (+N)" count, which is UI rather than transcript. */
const snippetBody = (result) => snippetText(result).replace(/\s*…\s*\(\+\d+\)\s*$/, "");
const markedText = (result) => {
  const text = snippetText(result);
  return result.highlights.map(({ start, end }) => text.slice(start, end));
};

/**
 * What the snippet component assumes about `highlights`: offsets into
 * `before + match + after`, one ascending non-overlapping run per term, never
 * reaching into the " … (+N)" tail, and always covering `match` itself.
 */
function assertHighlightShape(result) {
  const ranges = result.highlights;
  assert.ok(Array.isArray(ranges) && ranges.length > 0, "a result carries at least one range");
  const body = snippetBody(result);
  let previousEnd = -1;
  for (const { start, end } of ranges) {
    assert.ok(start > previousEnd, `ranges ascend without overlapping: ${JSON.stringify(ranges)}`);
    assert.ok(end > start, `range ${start}..${end} is not empty`);
    assert.ok(end <= body.length, `range ${start}..${end} reaches past the snippet text (${body.length})`);
    previousEnd = end;
  }
  const anchorStart = result.before.length;
  const anchorEnd = anchorStart + result.match.length;
  assert.ok(
    ranges.some(({ start, end }) => start <= anchorStart && end >= anchorEnd),
    `no range covers the match ${JSON.stringify(result.match)} in ${JSON.stringify(snippetText(result))}`,
  );
}

/** The row stays inside the 200-character budget the sidebar gives it. */
function assertSnippetFits(result) {
  const body = snippetBody(result);
  assert.ok(body.length <= 200, `snippet is ${body.length} characters: ${JSON.stringify(body)}`);
  assert.ok(markedText(result).every((text) => body.includes(text)), "every marked run is inside the snippet");
}

describe("session search", () => {
  // -------------------------------------------------------------------------
  // 1. one term
  // -------------------------------------------------------------------------
  describe("one term", () => {
    it("reports the matching text with the words around it and the entry to open", async (t) => {
      const session = writeSession(t, [{ ...message("user", "before NEEDLE after"), id: "matched-entry" }]);
      // The payload the sidebar row renders: surrounding text, the hit itself, and
      // where to jump in the transcript.
      assert.deepEqual((await search([session], "needle")).results, [
        {
          session,
          entryId: "matched-entry",
          blockIndex: 0,
          before: "before ",
          match: "NEEDLE",
          after: " after",
          highlights: [{ start: 7, end: 13 }],
        },
      ]);
    });

    it("ignores case and keeps the text as the transcript has it", async (t) => {
      const session = writeSession(t, [
        message("user", "Deployed to Staging"),
        message("assistant", [{ type: "text", text: "staging is green" }]),
      ]);
      for (const query of ["staging", "STAGING", "Staging"]) {
        const result = await one([session], query);
        assert.equal(result.match, "Staging", `first hit for ${query}`);
      }
    });

    it("lists the most recently modified session first", async (t) => {
      const oldest = writeSession(t, [message("user", "needle")], { id: "oldest", modified: "2026-01-01" });
      const middle = writeSession(t, [message("user", "needle")], { id: "middle", modified: "2026-01-15" });
      const newest = writeSession(t, [message("user", "needle")], { id: "newest", modified: "2026-02-01" });
      // Given out of order: the catalogue's own order must not decide what is shown.
      assert.deepEqual(
        (await search([middle, newest, oldest], "needle")).results.map(({ session: s }) => s.id),
        ["newest", "middle", "oldest"],
      );
    });

    it("returns no rows and no truncation for a term no session has", async (t) => {
      const session = writeSession(t, [message("user", "something else")]);
      assert.deepEqual(await search([session], "needle"), { results: [], truncated: false });
    });

    it("returns nothing for an empty or blank query instead of throwing", async (t) => {
      const session = writeSession(t, [message("user", "needle")]);
      for (const query of ["", " ", "   \n\t ", "　"]) {
        assert.deepEqual(await search([session], query), { results: [], truncated: false });
      }
    });

    it("finds one row per session even when several of its messages match", async (t) => {
      const session = writeSession(t, [
        message("user", "needle in the first message"),
        message("assistant", "needle again in the reply"),
      ]);
      const result = await search([session], "needle");
      assert.equal(result.results.length, 1);
      // The earliest hit wins, so the row always opens at the first occurrence.
      assert.equal(result.results[0].match, "needle");
      assert.equal(result.results[0].after, " in the first message");
    });
  });

  // -------------------------------------------------------------------------
  // 2. several terms: all of them, anywhere in the session
  // -------------------------------------------------------------------------
  describe("several terms must all be in the session", () => {
    it("accepts two words next to each other in one message", async (t) => {
      const session = writeSession(t, [message("user", "rolling out the payments rewrite")]);
      const result = await one([session], "payments rewrite");
      assert.equal(result.match, "payments");
      assert.deepEqual(markedText(result), ["payments", "rewrite"]);
    });

    it("accepts two words that sit in different messages", async (t) => {
      const session = writeSession(t, [
        { ...message("user", "alpha appears first"), id: "first" },
        { ...message("assistant", "then beta much later"), id: "second" },
      ]);
      // Words in different messages: the row anchors on the query's first word and
      // appends what it found of the other, so both reasons for the hit are visible.
      const result = await one([session], "alpha beta");
      assert.equal(result.entryId, "first");
      assert.equal(result.match, "alpha");
      assert.deepEqual(markedText(result), ["alpha", "beta"]);
      assert.match(snippetText(result), / … /);
      assertSnippetFits(result);
    });

    it("does not care about the order the words are typed in", async (t) => {
      const session = writeSession(t, [
        { ...message("user", "alpha appears first"), id: "first" },
        { ...message("assistant", "then beta much later"), id: "second" },
      ]);
      // "beta alpha" anchors on beta's message, so it opens where that word is.
      const reversed = await one([session], "beta alpha");
      assert.equal(reversed.entryId, "second");
      assert.equal(reversed.match, "beta");
      assert.deepEqual(markedText(reversed), ["beta", "alpha"]);
    });

    it("rejects a session that is missing one of the words", async (t) => {
      const session = writeSession(t, [
        message("user", "alpha appears here"),
        message("assistant", "nothing about the other word"),
      ]);
      assert.deepEqual((await search([session], "alpha beta")).results, []);
      assert.deepEqual((await search([session], "alpha gamma")).results, []);
    });

    it("treats runs of whitespace as one separator", async (t) => {
      const session = writeSession(t, [message("user", "alpha and beta together")]);
      assert.equal((await search([session], "alpha  beta")).results.length, 1);
      assert.equal((await search([session], "alpha\t\tbeta")).results.length, 1);
      assert.deepEqual(
        await search([session], "alpha beta"),
        await search([session], "  alpha   beta  "),
      );
    });

    it("requires every word however many are typed, with no term limit", async (t) => {
      const words = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
      const together = writeSession(t, [message("user", `x ${words} y`)]);
      assert.equal((await search([together], words)).results.length, 1);
      // Scattered over three messages, and one word short: the rule is all or nothing.
      const scattered = writeSession(t, [message("user", "a b c d"), message("user", "e f g h"), message("user", "i j k")]);
      assert.equal((await search([scattered], "a b c d e f g h i j k")).results.length, 1);
      const oneShort = writeSession(t, [message("user", "a b c d"), message("user", "e f g h"), message("user", "i j")]);
      assert.deepEqual((await search([oneShort], "a b c d e f g h i j k")).results, []);
    });
  });

  // -------------------------------------------------------------------------
  // 3. quoted phrases
  // -------------------------------------------------------------------------
  describe("quoted phrases", () => {
    it("keeps a quoted phrase together and apart from the other terms", async (t) => {
      const session = writeSession(t, [message("user", "gamma runs beside an alpha beta pair")]);
      assert.equal((await one([session], '"alpha beta"')).match, "alpha beta");
      assert.equal((await search([session], 'gamma "alpha beta"')).results.length, 1);
      assert.equal((await search([session], '"alpha beta" gamma')).results.length, 1);

      const apart = writeSession(t, [message("user", "alpha comes before beta does")]);
      assert.equal((await search([apart], "alpha beta")).results.length, 1);
      // Quoting is how to ask for the old adjacent-words behaviour back.
      assert.deepEqual((await search([apart], '"alpha beta"')).results, []);
    });

    it("reads an unclosed quote as a plain word", async (t) => {
      const session = writeSession(t, [message("user", "an alpha beta pair")]);
      assert.equal((await one([session], '"alpha')).match, "alpha");
      // A quote with nothing to close it never swallows the word it stands in front of.
      const quotedWord = writeSession(t, [message("user", 'the word alpha" stays literal')]);
      assert.equal((await one([quotedWord], 'alpha"')).match, 'alpha"');
    });

    it("searches a query of nothing but quotes as the literal string it is", async (t) => {
      const session = writeSession(t, [message("user", 'he said "" and left')]);
      // A query that parses to no term must not silently search nothing at all.
      assert.equal((await one([session], '""')).match, '""');
      assert.equal((await one([session], '"')).match, '"');
    });

    it("keeps a quote inside a word literal", async (t) => {
      const session = writeSession(t, [message("user", 'the foo"bar token and a lone " quote')]);
      assert.equal((await one([session], 'foo"bar')).match, 'foo"bar');
      assert.equal((await search([session], 'lone " quote')).results.length, 1);

      const plain = writeSession(t, [message("user", "alpha beta gamma")]);
      assert.equal((await search([plain], '"alpha beta" gamma')).results.length, 1);
      assert.deepEqual((await search([plain], '"alpha beta" delta')).results, []);
    });

    it("ignores an empty phrase inside an otherwise normal query", async (t) => {
      const session = writeSession(t, [message("user", "alpha beta gamma")]);
      assert.deepEqual(await search([session], 'alpha "" beta'), await search([session], "alpha beta"));
    });
  });

  // -------------------------------------------------------------------------
  // 4. nothing typed is a regular expression
  // -------------------------------------------------------------------------
  describe("punctuation is searched literally", () => {
    it("finds terms made of regex operators", async (t) => {
      const session = writeSession(t, [
        message("user", "uses C++ with std::vector, calls foo(bar), reads a.b, lists [x]"),
      ]);
      for (const term of ["C++", "std::vector", "foo(bar)", "a.b", "[x]", "(bar)"]) {
        const result = await one([session], term);
        assert.ok(result, `no hit for ${term}`);
        assert.equal(result.match, term);
      }
      assert.equal((await search([session], "C++ Rust")).results.length, 0);
    });

    it("does not let a dot stand for any character", async (t) => {
      const dotted = writeSession(t, [message("user", "config a.b lookup")]);
      assert.equal((await one([dotted], "a.b")).match, "a.b");
      const other = writeSession(t, [message("user", "config axb lookup")]);
      assert.deepEqual((await search([other], "a.b")).results, []);
    });

    it("finds backslashes and slashes, also when a writer escaped them", async (t) => {
      const backslash = writeSession(t, [message("user", "save C:\\temp\\new now")]);
      assert.equal((await one([backslash], "temp\\new")).match, "temp\\new");
      const double = writeSession(t, [message("user", "literal a\\\\b stays")]);
      assert.equal((await one([double], "\\\\")).match, "\\\\");

      const slash = writeSession(t, [message("user", "read a/b and/or the file")]);
      assert.equal((await one([slash], "a/b")).match, "a/b");
      assert.equal((await one([slash], "/")).match, "/");
      // Some exporters escape a forward slash, which must not hide the term.
      const escaped = writeSession(t, ['{"type":"message","message":{"role":"user","content":"see a\\/b here"}}']);
      assert.equal((await one([escaped], "a/b")).match, "a/b");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unicode
  // -------------------------------------------------------------------------
  describe("Unicode text", () => {
    it("searches Chinese as terms like any other word", async (t) => {
      const together = writeSession(t, [message("user", "我们部署然后上线了")]);
      const hit = await one([together], "部署 上线");
      assert.equal(hit.match, "部署");
      assert.deepEqual(markedText(hit), ["部署", "上线"]);
      assertHighlightShape(hit);

      const apart = writeSession(t, [
        { ...message("user", "第一步是部署"), id: "one" },
        { ...message("assistant", "第二步是上线"), id: "two" },
      ]);
      const cross = await one([apart], "部署 上线");
      assert.equal(cross.entryId, "one");
      assert.deepEqual(markedText(cross), ["部署", "上线"]);
      assert.match(snippetText(cross), / … /);
      assertSnippetFits(cross);
    });

    it("splits terms on a full-width space as on an ordinary one", async (t) => {
      const session = writeSession(t, [message("user", "先部署　再上线")]);
      const spaced = await search([session], "部署　上线");
      const plain = await search([session], "部署 上线");
      assert.equal(spaced.results.length, 1);
      assert.deepEqual(spaced, plain);
      // The space inside the quotation is normalised in what the row shows.
      assert.equal(spaced.results[0].after, " 再上线");
    });

    it("finds an emoji term and never cuts one in half", async (t) => {
      const session = writeSession(t, [message("user", "hot 🔥 fire and 📚 books")]);
      const hit = await one([session], "🔥");
      assert.equal(hit.match, "🔥");
      assertHighlightShape(hit);

      // Window boundaries land inside emoji too: no lone surrogate may reach the row.
      const wide = writeSession(t, [message("user", `${"🍎".repeat(40)} needle ${"🍎".repeat(40)}`)]);
      const wideHit = await one([wide], "needle");
      const text = snippetText(wideHit);
      assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u, `high surrogate alone: ${JSON.stringify(text)}`);
      assert.doesNotMatch(text, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u, `low surrogate alone: ${JSON.stringify(text)}`);
      assert.ok(text.includes("🍎"));

      const leading = writeSession(t, [message("user", `${"🔥".repeat(120)} needle`)]);
      assert.doesNotMatch(snippetText(await one([leading], "needle")), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    });

    it("keeps offsets of a multi-byte term usable by the row", async (t) => {
      const session = writeSession(t, [message("user", `${"x".repeat(200)}\n\u0130 中文 NEEDLE \n${"y".repeat(200)}`)]);
      const chinese = await one([session], "中文");
      assert.deepEqual(markedText(chinese), ["中文"]);
      assertHighlightShape(chinese);

      const ascii = await one([session], "needle");
      assert.equal(ascii.match, "NEEDLE");
      assert.deepEqual(markedText(ascii), ["NEEDLE"]);
      assertHighlightShape(ascii);
      assert.ok(ascii.before.startsWith("..."), "the cut before the window is marked");
      assert.ok(ascii.after.endsWith("..."), "the cut after the window is marked");
      assert.doesNotMatch(ascii.before, /\n/, "a newline inside the margin is folded into one space");
      assert.doesNotMatch(ascii.after, /\n/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. repeated terms
  // -------------------------------------------------------------------------
  describe("repeated terms", () => {
    it("counts a word typed several times once, whatever its case", async (t) => {
      const session = writeSession(t, [message("user", "one needle here")]);
      assert.deepEqual(
        await search([session], "needle NEEDLE needle"),
        await search([session], "needle"),
      );
      assert.equal((await search([session], "needle NEEDLE")).results.length, 1);
    });

    it("keeps apart words that differ only in case the search itself keeps apart", async (t) => {
      // Folding `ß` and `ẞ` together would drop a term that still has to match.
      const sharp = writeSession(t, [message("user", "Straße 12")]);
      assert.equal((await search([sharp], "ß")).results.length, 1);
      assert.deepEqual((await search([sharp], "ß ẞ")).results, []);

      const kelvin = writeSession(t, [message("user", "kilo kelvin")]); // plain k only
      assert.equal((await search([kelvin], "k")).results.length, 1);
      assert.deepEqual((await search([kelvin], "k K")).results, []);
      const both = writeSession(t, [message("user", "kilo Kelvin")]); // Kelvin sign too
      assert.equal((await search([both], "k K")).results.length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 7. size limits and incomplete searches
  // -------------------------------------------------------------------------
  describe("limits and what an incomplete search reports", () => {
    it("refuses a query longer than 200 characters", async (t) => {
      const session = writeSession(t, [message("user", "x".repeat(300))]);
      await assert.doesNotReject(search([session], "x".repeat(200)));
      await assert.rejects(search([session], "x".repeat(201)), RangeError);
    });

    it("stops after 30 rows and after 500 session files", async (t) => {
      const session = writeSession(t, [message("user", "needle")]);
      const sessions = Array.from({ length: 501 }, (_, index) => ({ ...session, id: String(index) }));

      const capped = await search(sessions, "needle");
      assert.equal(capped.results.length, 30);
      assert.equal(capped.truncated, true, "rows were left unexamined and the sidebar says so");

      // Neither cap is reached here, so nothing is reported as missing.
      assert.equal((await search(sessions.slice(0, 30), "needle")).truncated, false);
      // Even without a single match, the 501st file still counts as unexamined.
      assert.deepEqual(await search(sessions, "absent"), { results: [], truncated: true });
    });

    it("finds a match inside the first 16 MB of a file and drops the rest", async (t) => {
      const filler = Array.from({ length: 1900 }, () => "x".repeat(8192));
      const session = writeSession(t, [...filler, message("user", "late NEEDLE here"), ...filler.slice(0, 200)]);
      const result = await search([session], "needle");
      assert.equal(result.truncated, false, "the hit was inside what is read");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].match, "NEEDLE");
    });

    it("says it stopped when 16 MB read held no match", async (t) => {
      const filler = Array.from({ length: 2048 }, () => "x".repeat(8192));
      const session = writeSession(t, [...filler, message("user", "late NEEDLE here")]);
      assert.deepEqual(await search([session], "needle"), { results: [], truncated: true });
    });

    it("skips a line larger than 1 MB and says part of the file was left out", async (t) => {
      const huge = writeSession(t, [message("user", `needle in ${"x".repeat(1024 * 1024 + 1)}`)]);
      // Its own text is not searched at all.
      assert.deepEqual(await search([huge], "needle"), { results: [], truncated: true });

      const readable = writeSession(t, [
        message("user", `noise ${"y".repeat(1024 * 1024 + 1)}`),
        { ...message("assistant", "needle in a normal line"), id: "kept" },
      ]);
      const result = await search([readable], "needle");
      assert.deepEqual(result.results.map((hit) => hit.entryId), ["kept"]);
      assert.equal(result.truncated, true, "the skipped line is reported, not hidden");
    });

    it("keeps searching other sessions when one file is gone", async (t) => {
      const session = writeSession(t, [message("user", "needle")]);
      const missing = { ...session, id: "missing", path: join(session.cwd, "gone.jsonl") };
      const result = await search([missing, session], "needle");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].session.id, "session");
      assert.equal(result.truncated, true);
    });

    it("leaves out transient sessions and those without a file", async (t) => {
      const session = writeSession(t, [message("user", "needle")]);
      const transient = writeSession(t, [message("user", "needle")], { id: "transient", transient: true });
      const noFile = { ...session, id: "no-file", path: "" };
      const result = await search([transient, noFile, session], "needle");
      assert.deepEqual(result.results.map((hit) => hit.session.id), ["session"]);
      assert.equal(result.truncated, false);
    });

    it("stops at its time budget and reports the rows it never reached", async (t) => {
      const session = writeSession(t, [message("user", "no match"), message("user", "needle")]);
      let ticks = 0;
      t.mock.method(Date, "now", () => (++ticks <= 3 ? 0 : 4000));
      assert.deepEqual(await search([session], "needle"), { results: [], truncated: true });
    });

    it("answers an aborted request with no rows", async (t) => {
      const session = writeSession(t, [message("user", "needle")]);
      assert.deepEqual(await search([session], "needle", AbortSignal.abort()), {
        results: [],
        truncated: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // 8. what is searched in a session file
  // -------------------------------------------------------------------------
  describe("entries that hold searchable text", () => {
    it("looks only at user and assistant messages", async (t) => {
      const hidden = writeSession(t, [
        message("toolResult", "needle"),
        message("assistant", [
          { type: "thinking", thinking: "needle" },
          { type: "toolCall", name: "read", arguments: { path: "needle" } },
          { type: "image", data: "needle" },
        ]),
        { type: "compaction", summary: "needle" },
        { type: "custom", data: "needle" },
        { type: "model_change", modelId: "needle" },
        message("user", null),
        null,
      ]);
      assert.deepEqual((await search([hidden], "needle")).results, []);

      const user = writeSession(t, [{ ...message("user", "needle in a prompt"), id: "user-entry" }]);
      assert.equal((await one([user], "needle")).entryId, "user-entry");
      const assistant = writeSession(t, [{ ...message("assistant", [{ type: "text", text: "needle in a reply" }]), id: "reply" }]);
      assert.equal((await one([assistant], "needle")).entryId, "reply");
    });

    it("reads a message's content as text or as blocks", async (t) => {
      const string = writeSession(t, [{ ...message("user", "needle as a plain string"), id: "string" }]);
      const array = writeSession(t, [{ ...message("assistant", [{ type: "text", text: "needle as a block" }]), id: "array" }]);
      assert.equal((await one([string], "needle")).entryId, "string");
      assert.equal((await one([array], "needle")).entryId, "array");
    });

    it("skips a message whose blocks hold no text", async (t) => {
      const session = writeSession(t, [
        message("assistant", []),
        message("assistant", [{ type: "thinking", thinking: "needle" }]),
        message("assistant", [{ type: "image", data: "needle" }, { type: "toolCall", name: "read", arguments: {} }]),
        message("user", null),
        { ...message("user", [{ type: "text", text: "needle at last" }]), id: "text" },
      ]);
      assert.equal((await one([session], "needle")).entryId, "text");
    });

    it("names the text block the words came from, thinking and tools included", async (t) => {
      const session = writeSession(t, [
        message("assistant", [
          { type: "thinking", thinking: "pi-cwd-spark" },
          { type: "text", text: "earlier text" },
          { type: "toolCall", name: "read", arguments: {} },
          { type: "text", text: "正文 pi-cwd-spark" },
          { type: "text", text: "later text" },
        ]),
      ]);
      assert.equal((await one([session], "pi-cwd-spark")).blockIndex, 3);
      assert.equal((await one([session], "earlier text")).blockIndex, 1);
      assert.equal((await one([session], "later text")).blockIndex, 4);
      // Two blocks away from each other: the first one still owns the row.
      assert.equal((await one([session], "spark later")).blockIndex, 3);
    });

    it("keeps the entry id that opens the message, empty string included", async (t) => {
      const empty = writeSession(t, [{ ...message("user", "needle here"), id: "" }]);
      assert.equal((await one([empty], "needle")).entryId, "");
      const named = writeSession(t, [{ ...message("user", "needle here"), id: "kept" }]);
      assert.equal((await one([named], "needle")).entryId, "kept");
      // Nothing to open for a session whose entries carry no id of their own.
      const unnamed = writeSession(t, [message("user", "needle here")]);
      assert.equal((await one([unnamed], "needle")).entryId, undefined);
      const numeric = writeSession(t, [{ ...message("user", "needle here"), id: 7 }]);
      assert.equal((await one([numeric], "needle")).entryId, undefined);
    });

    it("ignores lines it cannot read instead of failing the search", async (t) => {
      const session = writeSession(t, [message("user", "needle before the mess")]);
      writeFileSync(
        session.path,
        `invalid\n{"type":\n${JSON.stringify(message("user", "needle after the mess"))}\n`,
      );
      const result = await search([session], "needle");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].match, "needle");
    });

    it("still searches the text written before a compaction", async (t) => {
      const session = writeSession(t, [
        { ...message("user", "needle before compaction"), id: "old" },
        { type: "compaction", summary: "compacted away" },
        message("user", "current question"),
      ]);
      assert.equal((await one([session], "needle")).entryId, "old");
    });
  });

  // -------------------------------------------------------------------------
  // 9. title fallback
  // -------------------------------------------------------------------------
  describe("the session title is the fallback", () => {
    it("uses the displayed name, or the generated one, when no message matches", async (t) => {
      const renamed = writeSession(t, [message("user", "unrelated body")], { id: "renamed", name: "Weekly Planning" });
      const generated = writeSession(t, [message("user", "unrelated body")], { id: "generated", name: "Generated Project Summary" });
      const unnamed = writeSession(t, [message("user", "unrelated body")], { id: "unnamed", firstMessage: "First Prompt Title" });

      // A title row has nothing to reveal in the transcript, so it carries no entry.
      assert.deepEqual((await search([renamed], "planning")).results, [
        {
          session: renamed,
          blockIndex: 0,
          titleMatch: true,
          before: "Weekly ",
          match: "Planning",
          after: "",
          highlights: [{ start: 7, end: 15 }],
        },
      ]);
      assert.equal((await one([generated], "project summary")).titleMatch, true);
      assert.equal((await one([unnamed], "prompt title")).titleMatch, true);
      assert.deepEqual((await search([renamed], "first prompt title")).results, []);
    });

    it("prefers the message hit, which keeps the jump into the transcript", async (t) => {
      const session = writeSession(t, [{ ...message("user", "Weekly Planning in the body"), id: "body-entry" }], {
        name: "Weekly Planning",
      });
      const result = await search([session], "planning");
      assert.equal(result.results.length, 1, "one row, not one per place it matched");
      assert.equal(result.results[0].entryId, "body-entry");
      assert.equal(result.results[0].titleMatch, undefined);
    });

    it("needs every word in the title, not one from the title and one from the body", async (t) => {
      const session = writeSession(t, [message("user", "the body mentions planning")], { name: "Weekly Planning" });
      assert.equal((await one([session], "weekly planning")).titleMatch, true);
      assert.deepEqual((await search([session], "weekly body")).results, []);
    });

    it("marks every word it found in the title", async (t) => {
      const session = writeSession(t, [message("user", "unrelated")], { name: "Alpha Beta Gamma" });
      const hit = await one([session], "alpha gamma");
      assert.equal(hit.titleMatch, true);
      assert.deepEqual(markedText(hit).sort(), ["Alpha", "Gamma"].sort());
      assertHighlightShape(hit);
    });
  });

  // -------------------------------------------------------------------------
  // 10. highlight ranges
  // -------------------------------------------------------------------------
  describe("highlight ranges the row paints", () => {
    it("marks every word, not only the one the snippet is built around", async (t) => {
      const session = writeSession(t, [message("user", "alpha then beta in one line")]);
      const hit = await one([session], "beta alpha");
      assert.deepEqual(hit.highlights, [
        { start: 0, end: 5 },
        { start: 11, end: 15 },
      ]);
      // Offsets into `before + match + after`, so the client paints them straight away.
      assert.deepEqual(markedText(hit), ["alpha", "beta"]);
      assertHighlightShape(hit);
    });

    it("paints one mark where two words overlap", async (t) => {
      const session = writeSession(t, [message("user", "alpha then beta in one line")]);
      assert.deepEqual((await one([session], "alp alpha")).highlights, [{ start: 0, end: 5 }]);
    });

    it("gives a single word exactly one range over its match", async (t) => {
      const session = writeSession(t, [message("user", "prefix needle suffix")]);
      const hit = await one([session], "needle");
      assert.deepEqual(hit.highlights, [{ start: hit.before.length, end: hit.before.length + hit.match.length }]);
    });

    it("keeps ranges ascending, non-overlapping and inside the snippet, (+N) tail excluded", async (t) => {
      const filler = "filler text ".repeat(200);
      const session = writeSession(t, [1, 2, 3, 4, 5, 6].map((n) => message("user", `${filler} t${n} ${filler}`)));
      const hit = await one([session], "t1 t2 t3 t4 t5 t6");
      assertHighlightShape(hit);
      // The words that did not fit are counted after the marked text, never inside it.
      assert.match(snippetText(hit), / … \(\+\d\)$/);
      const body = snippetBody(hit);
      assert.ok(markedText(hit).every((text) => body.includes(text)));
    });

    it("marks nothing inside the words' own separator marks", async (t) => {
      const session = writeSession(t, [
        message("user", "alpha in the first message"),
        message("assistant", "beta somewhere else entirely"),
      ]);
      const hit = await one([session], "alpha beta");
      const text = snippetText(hit);
      const gaps = [...text.matchAll(/ … /g)].map((match) => match.index);
      assert.ok(gaps.length > 0, `expected a separator in ${JSON.stringify(text)}`);
      for (const gap of gaps) {
        assert.ok(
          !hit.highlights.some(({ start, end }) => start < gap + 3 && end > gap),
          `a range covers the separator at ${gap}: ${JSON.stringify(hit.highlights)}`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // 11. the snippet itself
  // -------------------------------------------------------------------------
  describe("the snippet one row shows", () => {
    it("keeps the 80 characters around a single word", async (t) => {
      const session = writeSession(t, [message("user", `${"a".repeat(120)} needle ${"b".repeat(120)}`)]);
      const hit = await one([session], "needle");
      assert.equal(hit.before.length, 83, "80 characters plus the cut mark");
      assert.equal(hit.after.length, 83);
    });

    it("widens so two words of one message are shown together", async (t) => {
      const near = writeSession(t, [message("user", `alpha ${"x".repeat(50)} beta tail`)]);
      const nearHit = await one([near], "alpha beta");
      assert.deepEqual(markedText(nearHit), ["alpha", "beta"]);
      assertSnippetFits(nearHit);

      // Too far apart to share a window: the second word comes as its own excerpt.
      const far = writeSession(t, [message("user", `alpha ${"y".repeat(300)} beta`)]);
      const farHit = await one([far], "alpha beta");
      assert.deepEqual(markedText(farHit), ["alpha", "beta"]);
      assert.match(snippetText(farHit), / … /);
      assertSnippetFits(farHit);
    });

    it("never lets the row grow past its budget, however long the word is", async (t) => {
      const long = "x".repeat(150);
      const session = writeSession(t, [message("user", `${"y".repeat(50)} ${long} ${"z".repeat(50)}`)]);
      const hit = await one([session], long);
      assertSnippetFits(hit);
      assert.equal(hit.match.length, 150, "the whole term stays visible");
    });

    it("shows words from other messages, or counts those it cannot show", async (t) => {
      const filler = "filler text ".repeat(200);
      const session = writeSession(t, [
        message("user", `${filler} needle alpha ${filler}`),
        message("assistant", filler),
        message("assistant", `${filler} needle beta ${filler}`),
      ]);
      const hit = await one([session], "alpha beta");
      const text = snippetText(hit);
      assert.ok(text.includes("alpha"), `alpha missing: ${JSON.stringify(text)}`);
      assert.ok(text.includes("beta"), `beta missing: ${JSON.stringify(text)}`);
      assert.equal(hit.highlights.length, 2);
      assertSnippetFits(hit);
      // One set of dots, not one per side of the gap.
      assert.doesNotMatch(text, /\.\.\. …/);
      assert.doesNotMatch(text, /… \.\.\./);
      assert.doesNotMatch(text, /\.{4}/);
    });

    it("counts the words that no longer fit instead of hiding them", async (t) => {
      const filler = "filler text ".repeat(200);
      const session = writeSession(t, [1, 2, 3, 4, 5, 6].map((n) => message("user", `${filler} t${n} ${filler}`)));
      const hit = await one([session], "t1 t2 t3 t4 t5 t6");
      assert.match(snippetText(hit), / … \(\+\d\)$/, `no count in ${JSON.stringify(snippetText(hit))}`);
      assertSnippetFits(hit);
    });

    it("keeps the visible words marked when the anchor cannot grow", async (t) => {
      const longTerm = "z".repeat(150);
      const session = writeSession(t, [
        message("user", `aaaaaaaaaaaaaaaaaaaaaaaaa ${longTerm} bbbbbbbbbbbbbbbbbbbbbbbbb`),
        ...[1, 2, 3, 4, 5, 6].map((n) => message("user", `t${n} filler text`)),
      ]);
      const hit = await one([session], `${longTerm} t1 t2 t3 t4 t5 t6`);
      // A long anchor leaves no room for excerpts, so the other words are counted
      // rather than dropped, and the row stays inside its budget.
      assert.equal(hit.after, snippetBody(hit).slice(hit.before.length + hit.match.length) + " … (+6)");
      assert.equal(hit.match.length, 150, "the anchor word itself is not shortened");
      assert.ok(snippetBody(hit).length <= 200, `snippet was ${snippetBody(hit).length}`);
      // Only the anchor is marked: nothing inside the count is transcript text.
      assert.deepEqual(hit.highlights, [
        { start: hit.before.length, end: hit.before.length + hit.match.length },
      ]);
      assertSnippetFits(hit);
      // Known limit: the " … (+6)" tail is counted apart from the 200-character budget,
      // so the string handed to the row can run a few characters past it.
      assert.ok(snippetText(hit).length <= 210, `row was ${snippetText(hit).length}`);
    });

    it("still marks a later word when the one before it had no room", async (t) => {
      const session = writeSession(t, [
        { ...message("user", `${"x".repeat(100)} alpha ${"y".repeat(100)}`), id: "a" },
        { ...message("assistant", `${"p".repeat(60)} beta ${"q".repeat(60)}`), id: "b" },
        { ...message("user", "gamma"), id: "c" },
      ]);
      const hit = await one([session], "alpha beta gamma");
      const marks = markedText(hit);
      assert.ok(marks.includes("alpha"), `marks: ${JSON.stringify(marks)}`);
      // beta's own excerpt has no room left; that must not hide gamma behind it.
      assert.ok(marks.includes("gamma"), `marks: ${JSON.stringify(marks)}`);
      assertSnippetFits(hit);
      assert.doesNotMatch(snippetText(hit), /\.\.\. … /, "one set of dots at the join");
    });

    it("shows one mark per gap even when several excerpts are appended", async (t) => {
      const session = writeSession(t, [
        message("user", "alpha and its own long message that goes on and on for a while"),
        message("assistant", "beta in a message of its own that also goes on for a while"),
        message("user", "gamma in yet another message of its own that goes on for a while"),
      ]);
      const hit = await one([session], "alpha beta gamma");
      const text = snippetText(hit);
      assert.deepEqual(markedText(hit), ["alpha", "beta", "gamma"]);
      assert.doesNotMatch(text, /\.{4}/, `run of dots in ${JSON.stringify(text)}`);
      assert.doesNotMatch(text, /…\s*…/, `two separators in a row in ${JSON.stringify(text)}`);
      assertSnippetFits(hit);
    });
  });

  // -------------------------------------------------------------------------
  // 12. widening the search must not lose what it found before
  // -------------------------------------------------------------------------
  describe("nothing that used to match is lost", () => {
    it("still finds a session the two words matched as one string", async (t) => {
      const contiguous = writeSession(t, [message("user", "an alpha beta pair")]);
      assert.equal((await search([contiguous], "alpha beta")).results.length, 1);
      // And also finds the ones the old adjacent-words reading could not.
      const apart = writeSession(t, [message("user", "alpha first"), message("user", "then beta")]);
      assert.equal((await search([apart], "alpha beta")).results.length, 1);
    });

    it("keeps every session an exact-string search would have found (200 seeded rounds)", async (t) => {
      // Seeded PRNG (mulberry32) so the property run is reproducible.
      const mulberry32 = (seed) => {
        let a = seed >>> 0;
        return () => {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let s = Math.imul(a ^ (a >>> 15), 1 | a);
          s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
          return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
        };
      };
      const rand = mulberry32(0x1234abcd);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const WORDS = [
        "alpha", "beta", "gamma", "delta", "echo", "fox", "golf", "hotel", "india", "juliet",
        "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango",
      ];

      for (let round = 0; round < 200; round++) {
        const sessionCount = 1 + Math.floor(rand() * 12); // 1..12 sessions
        const sessions = [];
        const corpus = [];
        for (let i = 0; i < sessionCount; i++) {
          const entries = [];
          let searchable = "";
          for (let m = 0; m < 1 + Math.floor(rand() * 4); m++) {
            const role = pick(["user", "assistant"]);
            const words = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => pick(WORDS));
            const text = words.join(" ");
            entries.push(message(role, text));
            searchable += " " + text;
          }
          const name = rand() < 0.5 ? `${pick(WORDS)} ${pick(WORDS)}` : undefined;
          const firstMessage = `${pick(WORDS)} ${pick(WORDS)}`;
          const created = writeSession(t, entries, { id: `s${round}_${i}`, name, firstMessage });
          sessions.push(created);
          corpus.push({
            id: created.id,
            searchable: searchable.toLowerCase(),
            title: (name || firstMessage).toLowerCase(),
          });
        }
        // Multi-word queries built from the same vocabulary, 2 or 3 words.
        const query = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(WORDS)).join(" ");
        const found = new Set((await search(sessions, query)).results.map((hit) => hit.session.id));
        // What the old one-literal-string search answered: the query, lowercased,
        // sitting anywhere in a session's text or title. Every such session must still
        // be there, even though the terms now may sit apart.
        const needle = query.toLowerCase();
        for (const entry of corpus) {
          if (!entry.searchable.includes(needle) && !entry.title.includes(needle)) continue;
          assert.ok(
            found.has(entry.id),
            `round ${round}: '${query}' used to match ${entry.id} and does no more ` +
            `(text tail: ${entry.searchable.slice(-80)})`,
          );
        }
      }
    });
  });
});
