import assert from "node:assert/strict";
import test from "node:test";
import { detectOptions, formatQuote, parseParagraph, splitQuestions } from "./quote-reply.ts";

test("quoted replies preserve underscores in identifiers and env var names", () => {
  // Regression: clean() used to strip `_` as if it were markdown emphasis,
  // mangling PI_WEB_BASE_DOMAIN → PIWEBBASEDOMAIN in quoted replies.
  assert.equal(formatQuote("命名你定：PI_WEB_BASE_DOMAIN"), "> 命名你定：PI_WEB_BASE_DOMAIN\n");
  const [seg] = splitQuestions("用 PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？");
  assert.match(seg, /PI_WEB_BASE_DOMAIN/);
  assert.match(seg, /PIWEBPROXYSUBFIX/);
});

test("splitQuestions keeps an A-还是-B choice whole with underscores intact", () => {
  const parts = splitQuestions("命名你定：PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？");
  assert.deepEqual(parts, ["命名你定：PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？"]);
});

test("formatQuote keeps the rendered text verbatim (no markdown processing)", () => {
  // The input is already-rendered text — literal chars survive quoting.
  assert.equal(formatQuote("用 *斜体* 强调 `code` ~~删除~~"), "> 用 *斜体* 强调 `code` ~~删除~~\n");
});

test("detectOptions still recognizes A-还是-B choices and keeps underscores", () => {
  const options = detectOptions("命名你定：PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？");
  assert.ok(options, "expected a choice to be detected");
  assert.equal(options.length, 2);
  assert.ok(options.some((o) => o.value.includes("PI_WEB_BASE_DOMAIN")));
  assert.ok(options.some((o) => o.value.includes("PIWEBPROXYSUBFIX")));
});

test("parseParagraph yields options + full quoted segment for env-var choices", () => {
  const [seg] = parseParagraph("用 PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？");
  assert.equal(seg.text, "用 PI_WEB_BASE_DOMAIN 还是 PIWEBPROXYSUBFIX？");
  assert.ok(seg.options?.length === 2);
});
