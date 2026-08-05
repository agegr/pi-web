import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx" class="markdown-local-file-link">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("makes inline-code file paths clickable in the app", () => {
  const html = renderMarkdown("Open `components/MarkdownBody.tsx:42`.");

  assert.match(html, /class="markdown-local-file-button"/);
  assert.ok(html.includes('title="/home/me/project/components/MarkdownBody.tsx"'));
  assert.doesNotMatch(html, /target="_blank"/);
});

test("makes plain local paths clickable without changing web URLs", () => {
  const html = renderMarkdown("See components/MarkdownBody.tsx and https://example.com/docs.");

  assert.ok(html.includes('<a href="components/MarkdownBody.tsx" class="markdown-local-file-link">components/MarkdownBody.tsx</a>'));
  assert.ok(!html.includes('class="markdown-local-file-link">//example.com/docs'));
});

test("recognizes Windows paths in plain conversation text", () => {
  const html = renderMarkdown(String.raw`Open C:\\work\\project\\src\\app.ts:12 now.`);

  assert.ok(html.includes('class="markdown-local-file-link">C:\\work\\project\\src\\app.ts:12</a>'));
});

test("does not mark folders or pi slash commands as clickable files", () => {
  const html = renderMarkdown("Use `/model`, then inspect `components/` or docs/reference.");

  assert.doesNotMatch(html, /markdown-local-file-(?:button|link)/);
  assert.match(html, /<code class="markdown-inline-code">\/model<\/code>/);
  assert.match(html, /<code class="markdown-inline-code">components\/<\/code>/);
});

test("does not mark provider model ids as clickable files", () => {
  const html = renderMarkdown([
    "**openai-codex/gpt-5.6-sol**",
    "**openai-codex/gpt-5.6-terra**",
    "**openai-codex/gpt-5.6-luna**",
  ].join("\\n"));

  assert.doesNotMatch(html, /markdown-local-file-(?:button|link)/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});
