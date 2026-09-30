import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath, markdownPreviewRemarkPlugins, markdownPreviewRehypePlugins } = await jiti.import("../lib/markdown.ts");
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

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const relativeHtml = renderMarkdown("[file](components/MarkdownBody.tsx)");
  const fileUrlHtml = renderMarkdown("[report](file:///home/me/project/report.html)");

  assert.match(relativeHtml, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(relativeHtml, /target=|rel=|\snode=/);
  assert.match(fileUrlHtml, /<a href="file:\/\/\/home\/me\/project\/report\.html">report<\/a>/);
  assert.doesNotMatch(fileUrlHtml, /target=|rel=|\snode=/);
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

test("renders backslash-escaped backticks inside inline code", () => {
  const html = renderMarkdown("`AudioManager\\`1.cs`");

  assert.match(html, /<code[^>]*>AudioManager`1\.cs<\/code>/);
  assert.doesNotMatch(html, /<\/code>1\.cs`/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("keeps prices and bold headings intact across a paragraph line break", () => {
  const html = renderMarkdown("**3. Membership — $20/mo (+tax)**\nOne free hour monthly. Waives the $6 activation fee.\n→ https://example.com/pricing");

  assert.match(html, /<strong>3\. Membership — \$20\/mo \(\+tax\)<\/strong>/);
  assert.match(html, /One free hour monthly\. Waives the \$6 activation fee\./);
  assert.match(html, /href="https:\/\/example\.com\/pricing"/);
  assert.doesNotMatch(html, /class="katex|\*\*/);
});

test("keeps adjacent amounts, ranges and decimals as currency", () => {
  for (const prices of ["$15+$15", "$20–$30", "$1,200.50 or $900.00", "**$20** and *$6*", "US$20 / CA$30"]) {
    const html = renderMarkdown(prices);
    assert.doesNotMatch(html, /class="katex/, prices);
    assert.equal((html.match(/\$/g) ?? []).length, 2, prices);
  }
});

test("does not let a price consume later math in the same paragraph", () => {
  const html = renderMarkdown("Pay $20 for the $x + 1$ option, or $30 for $2x + 3$.");

  assert.match(html, /Pay \$20 for the/);
  assert.match(html, /or \$30 for/);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2);
  assert.match(html, /<annotation encoding="application\/x-tex">x \+ 1<\/annotation>/);
  assert.match(html, /<annotation encoding="application\/x-tex">2x \+ 3<\/annotation>/);
});

test("retains single-dollar equations, numeric math, balanced padding and multiline math", () => {
  for (const math of ["$x + y$", "$2 + 2 = 4$", "$20$", "$ x + y $", "$x $", "$ x$", "$x$2", "$x +\ny$", "$$x + y$$"]) {
    const html = renderMarkdown(math);
    assert.match(html, /class="katex"/, math);
    assert.doesNotMatch(html, /katex-error/, math);
  }
});

test("file previews and minimap Markdown use the same currency-safe math rules", () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: markdownPreviewRemarkPlugins,
    rehypePlugins: markdownPreviewRehypePlugins,
  }, "**Price: $20/month**\nPlus a $6 fee. Formula: $2 + 2 = 4$."));
  assert.match(html, /<strong>Price: \$20\/month<\/strong>/);
  assert.match(html, /Plus a \$6 fee/);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
});

test("leaves escaped currency, code and link destinations intact", () => {
  const html = renderMarkdown("Prices: \\$20 and \\$6. Code: `$20 + $6`. [Price](https://example.com/$20/$6)");
  assert.doesNotMatch(html, /class="katex/);
  assert.match(html, /Prices: \$20 and \$6\./);
  assert.match(html, /<code[^>]*>\$20 \+ \$6<\/code>/);
  assert.match(html, /href="https:\/\/example\.com\/\$20\/\$6"/);
  const fenced = renderMarkdown("```text\n$20 + $6\n```");
  assert.doesNotMatch(fenced, /class="katex/);
});

test("currency text still passes through HTML and URL sanitization", () => {
  const html = renderMarkdown('$20 <img src="x" onerror="alert(1)"> $6 [click](javascript:alert(1))');
  assert.doesNotMatch(html, /onerror|javascript:|class="katex/);
  assert.match(html, /\$20/);
  assert.match(html, /\$6/);
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

test("opens markdown images in the shared image preview", () => {
  const localHtml = renderMarkdown("![chart](docs/tmp/chart.png)");
  const remoteHtml = renderMarkdown("![logo](https://example.com/logo.png)");

  assert.match(localHtml, /<button[^>]+aria-label="Preview image: chart"[^>]*>/);
  assert.match(localHtml, /<img[^>]+src="\/api\/files\/home\/me\/project\/docs\/tmp\/chart\.png\?type=read"/);
  assert.match(localHtml, /<img[^>]+alt="chart"/);
  assert.match(remoteHtml, /<button[^>]+aria-label="Preview image: logo"[^>]*>/);
  assert.match(remoteHtml, /<img[^>]+src="https:\/\/example\.com\/logo\.png"/);
});

test("keeps linked markdown images as links instead of nested preview buttons", () => {
  const html = renderMarkdown("[![diagram](docs/tmp/diagram.png)](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")[^>]*>/,
  );
  assert.match(html, /<img[^>]+alt="diagram"/);
  assert.doesNotMatch(html, /<a[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<\/a>/);
});

test("uses a generic preview label when a markdown image has no alt text", () => {
  const html = renderMarkdown("![](https://example.com/shot.png)");

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.doesNotMatch(html, /Preview image:/);
});

test("keeps CJK prose out of an autolinked URL", () => {
  const html = renderMarkdown("开 http://localhost:4321，或直接开 library/x.png。");

  assert.match(html, /<a (?=[^>]*href="http:\/\/localhost:4321")[^>]*>http:\/\/localhost:4321<\/a>/);
  assert.match(html, /<\/a>，或直接开 library\/x\.png。/);
  assert.doesNotMatch(html, /%EF%BC%8C/);
});

test("stops a bare autolink at trailing CJK punctuation", () => {
  const html = renderMarkdown("见 https://example.com/docs。");

  assert.match(html, /<a (?=[^>]*href="https:\/\/example\.com\/docs")[^>]*>https:\/\/example\.com\/docs<\/a>/);
  assert.match(html, /<\/a>。/);
});

test("leaves explicit markdown links, CJK paths and query strings intact", () => {
  const explicit = renderMarkdown("[文档](https://example.com/docs)，说明");
  assert.match(explicit, /<a (?=[^>]*href="https:\/\/example\.com\/docs")[^>]*>文档<\/a>/);
  assert.match(explicit, /<\/a>，说明/);

  const cjkPath = renderMarkdown("https://zh.wikipedia.org/wiki/中文条目");
  assert.match(cjkPath, /href="https:\/\/zh\.wikipedia\.org\/wiki\/%E4%B8%AD%E6%96%87%E6%9D%A1%E7%9B%AE"/);

  const query = renderMarkdown("https://a.com/p?a=1&b=2，后面");
  assert.match(query, /href="https:\/\/a\.com\/p\?a=1&amp;b=2"/);
  assert.match(query, /<\/a>，后面/);
});

test("turns line endings into <br> only when asked to keep line breaks", () => {
  assert.match(renderMarkdown("one\ntwo"), /<p>one\ntwo<\/p>/);
  assert.doesNotMatch(renderMarkdown("one\ntwo"), /<br/);

  for (const markdown of ["one\ntwo", "one\r\ntwo", "one\rtwo", "one   \t\n   two"]) {
    assert.match(renderMarkdown(markdown, { keepLineBreaks: true }), /<p>one<br\/>two<\/p>/);
  }
});

test("keeps typed line breaks in tight list items and headings", () => {
  const ordered = renderMarkdown("1. 看门狗的原理是（ ）\nA. 监控温度\nB. 计数器\n2. 下一题", { keepLineBreaks: true });
  const nested = renderMarkdown("- outer\n  more\n  - inner\n- next", { keepLineBreaks: true });
  const heading = renderMarkdown("Heading one\nheading two\n===", { keepLineBreaks: true });

  assert.match(ordered, /<li>看门狗的原理是（ ）<br\/>A\. 监控温度<br\/>B\. 计数器<\/li>/);
  assert.match(ordered, /<li>下一题<\/li>/);
  // The newline before a nested list separates blocks, so it must not become a <br>.
  assert.match(nested, /<li>outer<br\/>more\n<ul>\n<li>inner<\/li>/);
  assert.match(heading, /<h1>Heading one<br\/>heading two<\/h1>/);
  assert.doesNotMatch(renderMarkdown("- alpha\n\n- beta", { keepLineBreaks: true }), /<br/);
});

test("renders a hard break once when keeping line breaks", () => {
  // remark-rehype writes an mdast break as <br> plus "\n", which the user
  // bubble's pre-wrap paragraphs would show as a blank line.
  const html = renderMarkdown("trailing spaces  \nbackslash\\\nend", { keepLineBreaks: true });

  assert.match(html, /<p>trailing spaces<br\/>backslash<br\/>end<\/p>/);
});

test("leaves code and math line endings alone when keeping line breaks", () => {
  const code = renderMarkdown("```\nfirst\nsecond\n```", { keepLineBreaks: true });
  const math = renderMarkdown("$$\nx = 1\ny = 2\n$$", { keepLineBreaks: true });
  const emphasis = renderMarkdown("*one\ntwo* `a b`", { keepLineBreaks: true });

  assert.doesNotMatch(code, /<br/);
  assert.match(code, /first[\s\S]*\n[\s\S]*second/);
  assert.doesNotMatch(math, /<br/);
  assert.match(math, /<annotation encoding="application\/x-tex">x = 1\ny = 2<\/annotation>/);
  assert.match(emphasis, /<em>one<br\/>two<\/em>/);
});

test("keeps a block that opens a raw-text tag as it renders without line breaks", () => {
  // A <br> after an unclosed <textarea> or <script> ends rehype-raw's raw-text
  // state, which glued the lines together or dropped the rest of the block.
  for (const markdown of [
    "Use a <textarea> here\nand a button\nplease",
    "Set <title>My\nPage</title> first\nthen deploy",
    "add <script>a()\nb()</script> to the page\nthen reload",
    "some *<style>x\ny</style>* then\nnext",
  ]) {
    assert.equal(renderMarkdown(markdown, { keepLineBreaks: true }), renderMarkdown(markdown));
  }

  assert.match(renderMarkdown("normal <kbd>Ctrl</kbd>\nline two", { keepLineBreaks: true }), /<\/kbd><br\/>line two/);
  const list = renderMarkdown("- item <textarea>\n  more\n- two\n  lines", { keepLineBreaks: true });
  assert.match(list, /<li>two<br\/>lines<\/li>/);
});
