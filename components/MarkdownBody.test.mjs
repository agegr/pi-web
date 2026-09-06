import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath, markdownRemarkPlugins, markdownRehypePlugins } = await jiti.import("../lib/markdown.ts");
const { remarkFileLinks } = await jiti.import("../lib/remark-file-links.ts");
const { default: ReactMarkdown } = await import("react-markdown");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MarkdownBody, {
        cwd: "/home/me/project",
        onOpenFile() {},
        ...props,
      }, markdown),
    ),
  );
}

test("full-path metadata survives sanitization while the original label remains intact", () => {
  let label;
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [...markdownRemarkPlugins, [remarkFileLinks, { cwd: "D:/project" }]],
    rehypePlugins: markdownRehypePlugins,
    components: { a({ node, children }) {
      label = node.properties.dataFilePathLabel;
      return React.createElement("span", null, children);
    } },
  }, "`src/main.ts`"));
  assert.equal(label, "D:/project/src/main.ts");
  assert.match(html, /<code>src\/main.ts<\/code>/);
});

test("local path links retain neutral code styling without an underline", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /a\.markdown-local-file-link:hover \{[^}]*color: var\(--text\);[^}]*text-decoration: none;[^}]*background: var\(--bg-subtle\);/);
  const link = await readFile(new URL("./LocalFileLink.tsx", import.meta.url), "utf8");
  assert.match(link, /title=\{fullPathLabel \?\? filePath\}/);
  assert.match(link, /onClick=\{handleClick\}>\s*\{children\}/);
  assert.doesNotMatch(link, /\{fullPathLabel \?\? children\}/);
});

test("keeps original inline-code path labels until filesystem validation succeeds", () => {
  const html = renderMarkdown("`components/MarkdownBody.tsx:12` 和 `D:\\My Project\\报告.md`", { cwd: "D:/repo" });
  assert.match(html, /<code[^>]*>components\/MarkdownBody.tsx:12<\/code>/);
  assert.ok(html.includes("D:\\My Project\\报告.md"));
  assert.doesNotMatch(html, /<a |D:\/repo/);
});

test("preserves plain paths and punctuation while validation is pending", () => {
  const html = renderMarkdown("文件： /home/me/project/report.md，另见 components/MarkdownBody.tsx。");
  assert.ok(html.includes("文件： /home/me/project/report.md，另见 components/MarkdownBody.tsx。"));
  assert.doesNotMatch(html, /<a /);
});

test("does not autolink code blocks, ordinary inline code, or paths without a handler", () => {
  assert.doesNotMatch(renderMarkdown("```text\n/home/me/project/report.md\n```\n\n`hello`"), /<a /);
  assert.doesNotMatch(renderMarkdown("`src/index.ts` /home/me/project/report.md", { onOpenFile: undefined }), /<a /);
  const html = renderMarkdown("[report](/home/me/project/report.md)");
  assert.doesNotMatch(html, /<a /);
});

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("also requires validation for explicit local markdown links", () => {
  const relativeHtml = renderMarkdown("[file](components/MarkdownBody.tsx)");
  const fileUrlHtml = renderMarkdown("[report](file:///home/me/project/report.html)");

  assert.match(relativeHtml, />file<\/p>/);
  assert.match(fileUrlHtml, />report<\/p>/);
  assert.doesNotMatch(relativeHtml + fileUrlHtml, /<a |target=|rel=|\snode=/);
});

test("keeps file URLs inert without an in-app file handler", () => {
  const html = renderMarkdown("[report](file:///home/me/project/report.html)", { onOpenFile: undefined });

  assert.match(html, /<a href="" target="_blank" rel="noopener noreferrer">report<\/a>/);
});

test("keeps single-tilde CJK numeric ranges literal instead of striking them", () => {
  const html = renderMarkdown("5~7U 保证金 × 100~200倍杠杆");

  assert.doesNotMatch(html, /<del>/);
  assert.match(html, /5~7U/);
  assert.match(html, /100~200倍/);
});

test("still renders double-tilde strikethrough", () => {
  const html = renderMarkdown("~~gone~~");

  assert.match(html, /<del>gone<\/del>/);
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

test("renders model-emitted bracket-only formula lines as display math", () => {
  const html = renderMarkdown(String.raw`平均一致性：

[ C(x) = \frac{2}{T(T-1)} \sum_{i<j} S(\hat{y}^{(i)}, \hat{y}^{(j)}) ]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /\\sum/);
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

test("previews completed Mermaid diagrams by default", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```");

  assert.match(html, /mermaid-block-loading/);
  assert.match(html, />Source</);
  assert.doesNotMatch(html, /A --&gt; B/);
});

test("keeps Mermaid source visible while the response is streaming", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```", { isStreaming: true });

  assert.doesNotMatch(html, /mermaid-block-loading/);
  assert.match(html, />Preview</);
  assert.match(html, /A --&gt; B/);
});
