import assert from "node:assert/strict";
import test from "node:test";
import { splitReplyLinks } from "./reply-links.ts";

test("turns bare HTTP(S) URLs into link segments", () => {
  assert.deepEqual(splitReplyLinks("LeetCode: https://leetcode.com/problemset/"), [
    { type: "text", value: "LeetCode: " },
    { type: "link", value: "https://leetcode.com/problemset/", href: "https://leetcode.com/problemset/" },
  ]);
});

test("keeps sentence punctuation outside links", () => {
  assert.deepEqual(splitReplyLinks("Try (https://example.com/path), then https://example.org。"), [
    { type: "text", value: "Try (" },
    { type: "link", value: "https://example.com/path", href: "https://example.com/path" },
    { type: "text", value: "), then " },
    { type: "link", value: "https://example.org", href: "https://example.org" },
    { type: "text", value: "。" },
  ]);
});

test("does not turn non-HTTP schemes or plain domains into links", () => {
  const text = "javascript:alert(1) and example.com stay text";
  assert.deepEqual(splitReplyLinks(text), [{ type: "text", value: text }]);
});
