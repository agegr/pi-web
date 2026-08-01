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

function renderMarkdown(markdown, extraProps = {}) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
      ...extraProps,
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

test("renders local file markdown links as downloadable file chips", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)", {
    sessionId: "11111111-1111-1111-1111-111111111111",
  });

  assert.match(html, /class="markdown-file-link"/);
  assert.match(html, /href="\/api\/files\/home\/me\/project\/components\/MarkdownBody\.tsx\?type=download&amp;sessionId=11111111-1111-1111-1111-111111111111"/);
  assert.match(html, /download="MarkdownBody\.tsx"/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("recognizes bare relative file links with line numbers", () => {
  const html = renderMarkdown("[source](MarkdownBody.tsx:42)");

  assert.match(html, /class="markdown-file-link"/);
  assert.match(html, /download="MarkdownBody\.tsx"/);
});

test("renders Windows backslash file links as downloadable file chips", () => {
  const html = renderMarkdown(String.raw`[下载](D:\\桌面文件\\易智瑞\\数据731\\结果.xlsx)`, {
    sessionId: "11111111-1111-1111-1111-111111111111",
  });

  assert.match(html, /class="markdown-file-link"/);
  assert.match(html, /download="结果\.xlsx"/);
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
