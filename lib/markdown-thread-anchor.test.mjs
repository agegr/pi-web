import assert from "node:assert/strict";
import test from "node:test";

const { findMarkdownThreadAnchor } = await import("./markdown-thread-anchor.ts");

const markdown = `## Authentication

Use rotating tokens.

- Retry transient failures
- Report permanent failures`;

test("resolves headings, paragraphs, and list items to stable Markdown block keys", () => {
  assert.equal(findMarkdownThreadAnchor(markdown, "## Authentication", "0"), "0:h2:0");
  assert.equal(findMarkdownThreadAnchor(markdown, "rotating tokens", "0"), "0:p:19");
  assert.equal(findMarkdownThreadAnchor(markdown, "- Retry transient failures", "0"), "0:li:41");
});

test("returns undefined when selected text does not belong to the Markdown", () => {
  assert.equal(findMarkdownThreadAnchor(markdown, "not in this response", "0"), undefined);
});
