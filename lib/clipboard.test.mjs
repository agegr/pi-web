import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLinkPaste } from "./clipboard.ts";

test("a URL pasted over selected text becomes a Markdown link", () => {
  assert.equal(
    formatLinkPaste("https://example.com/docs", "", "the docs"),
    "[the docs](<https://example.com/docs>)",
  );
});

test("a copied rich-text anchor keeps its URL", () => {
  assert.equal(
    formatLinkPaste(
      "Example docs",
      '<html><body><!--StartFragment--><a href="https://example.com?a=1&amp;b=2"><b>Example</b> docs</a><!--EndFragment--></body></html>',
      "",
    ),
    "[Example docs](<https://example.com?a=1&b=2>)",
  );
});

test("a rich-text list preserves every link and its plain-text layout", () => {
  assert.equal(
    formatLinkPaste(
      "Resources\n• NewGrad Jobs\n• Atlassian Early Careers\nOther notes",
      '<h2>Resources</h2><ul><li><a href="https://newgrad.example/jobs">NewGrad Jobs</a></li><li><a href="https://atlassian.com/careers">Atlassian Early Careers</a></li></ul><p>Other notes</p>',
      "",
    ),
    "Resources\n• [NewGrad Jobs](<https://newgrad.example/jobs>)\n• [Atlassian Early Careers](<https://atlassian.com/careers>)\nOther notes",
  );
});

test("plain text and unsafe links use native paste", () => {
  assert.equal(formatLinkPaste("hello", "", "selected"), null);
  assert.equal(formatLinkPaste("click", '<a href="javascript:alert(1)">click</a>', ""), null);
});
