import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";

const { parseFenceBlock, splitMarkdownBlocks } = await createJiti(import.meta.url).import("./markdown-blocks.ts");

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true });

function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "position").map(([key, value]) => [key, strip(value)]));
}

// The rendered blocks, ignoring the "\n" text nodes remark-rehype puts between them.
function render(markdown) {
  const tree = processor.runSync(processor.parse(markdown));
  return strip(tree.children.filter((node) => !(node.type === "text" && /^\s*$/.test(node.value))));
}

function renderSplit(markdown) {
  return splitMarkdownBlocks(markdown).flatMap(render);
}

const DOCUMENT = [
  "## 渲染性能",
  "",
  "浏览器每帧大约有 16ms，`requestAnimationFrame` 里只做读取。",
  "",
  "1. 第一步",
  "",
  "2. 第二步，松散列表",
  "   继续这一项",
  "",
  "   第二段，缩进",
  "",
  "- tight",
  "- list",
  "",
  "```ts",
  "const a = 1;",
  "",
  "",
  "const b = 2;",
  "```",
  "",
  "| 指标 | 值 |",
  "| --- | --- |",
  "| FPS | 60 |",
  "",
  "$$",
  "a + b",
  "",
  "c",
  "$$",
  "",
  "    indented code",
  "",
  "    more indented code",
  "",
  "> quote",
  "",
  "> another quote",
  "",
  "~~~",
  "tilde fence",
  "",
  "```",
  "~~~",
  "",
  "Text with `$$` in code and a trailing paragraph.",
  "",
  "Final paragraph **bold**.",
].join("\n");

test("the blocks join back to the input", () => {
  for (const markdown of [DOCUMENT, "", "one", "a\n\nb\n", "a\r\n\r\nb", "\n\n\nx\n\n"]) {
    assert.equal(splitMarkdownBlocks(markdown).join(""), markdown);
  }
});

test("splits only where the next block cannot continue the previous one", () => {
  const blocks = splitMarkdownBlocks(DOCUMENT);
  assert.ok(blocks.length >= 8, `expected several blocks, got ${blocks.length}`);
  assert.ok(blocks.some((block) => block.startsWith("```ts") && block.includes("const b = 2;")), "a fence stays whole");
  assert.ok(blocks.some((block) => block.includes("1. 第一步") && block.includes("第二段，缩进")), "a loose list stays whole");
  assert.ok(blocks.some((block) => block.startsWith("$$") && block.includes("c\n$$")), "display math stays whole");
});

test("every streamed prefix renders the same split as whole", () => {
  for (let end = 1; end <= DOCUMENT.length; end++) {
    const prefix = DOCUMENT.slice(0, end);
    assert.deepEqual(renderSplit(prefix), render(prefix), `prefix of ${end} characters:\n${prefix}`);
  }
});

test("raw HTML and front matter stop the splitting", () => {
  const details = "Intro\n\n<details>\n<summary>more</summary>\n\nhidden\n\n</details>\n\nAfter";
  assert.deepEqual(splitMarkdownBlocks(details), ["Intro\n\n", "<details>\n<summary>more</summary>\n\nhidden\n\n</details>\n\nAfter"]);
  const inline = "Hello <b>world\n\nmore</b>\n\nlast";
  assert.deepEqual(splitMarkdownBlocks(inline), [inline]);
  const frontMatter = "---\ntitle: x\n\nother: y\n---\n\nBody";
  assert.deepEqual(splitMarkdownBlocks(frontMatter), [frontMatter]);
});

test("fence-like code lines with trailing content do not close a streaming fence", () => {
  for (const marker of ["```", "~~~"]) {
    const markdown = `${marker}text\nfirst\n${marker}still code\n\nsecond\n${marker}\n\nAfter`;
    for (let end = 1; end <= markdown.length; end++) {
      const prefix = markdown.slice(0, end);
      assert.deepEqual(renderSplit(prefix), render(prefix), prefix);
    }
  }
});

test("streamed reference links and footnotes share definitions across paragraphs", () => {
  for (const markdown of [
    "Read [the guide][guide].\n\n[guide]: https://example.com/guide",
    "[guide]: https://example.com/guide\n\nRead [the guide][guide].",
    "![diagram][image]\n\n[image]: https://example.com/diagram.png",
    "Note[^1].\n\n[^1]: Footnote text",
  ]) {
    for (let end = 1; end <= markdown.length; end++) {
      const prefix = markdown.slice(0, end);
      assert.deepEqual(renderSplit(prefix), render(prefix), prefix);
    }
  }
});

test("a ]: outside a definition line keeps the splitting", () => {
  const markdown = "Skip the flag:\n\n```python\nfor x in items[1:]:\n    if items[0]:\n        print(x)\n```\n\nThe key `map[k]:` is read once.\n\nDone.";
  assert.equal(splitMarkdownBlocks(markdown).length, 4);
});

/** What react-markdown's `code` renderer would get for a block that parses to one fence. */
function parsedFence(markdown) {
  const nodes = render(markdown);
  if (nodes.length !== 1 || nodes[0].tagName !== "pre") return null;
  const code = nodes[0].children[0];
  const lang = (code.properties.className?.[0] ?? "").replace("language-", "").toLowerCase();
  return { lang, code: (code.children[0]?.value ?? "").replace(/\n$/, "") };
}

test("a fence-only streaming block renders straight, exactly as the parser would hand it over", () => {
  const blocks = [
    "```python\ndef a():\n    return 1\n```\n\n",
    "```Python title=x\nx = 1\n```",
    "```js\nconst a = 1;\nconst b",            // still streaming: no closing line yet
    "```js\nconst a = 1;\n",                   // a chunk that ends on a newline
    "~~~~\n```\nnested\n```\n~~~~\n",       // a longer fence holds shorter ones
    "```\n\n\nplain\n```\n",
    "```js\nx\n\n```\n",                   // a blank last line is code
    "```js\nx\n\n",                          // still open, ending on a blank line
    "```js\nx\n   ```  \t\n\n",              // an indented closing line with trailing blanks
    "````md\n```js\nx\n```\n````",          // a shorter fence inside a longer one
  ];
  for (const block of blocks) assert.deepEqual(parseFenceBlock(block), parsedFence(block), block);
});

test("every streamed prefix's fence-only blocks render straight as the parser would", () => {
  let straight = 0;
  for (let end = 1; end <= DOCUMENT.length; end++) {
    for (const block of splitMarkdownBlocks(DOCUMENT.slice(0, end))) {
      const fence = parseFenceBlock(block);
      if (!fence) continue;
      straight += 1;
      assert.deepEqual(fence, parsedFence(block), `block:\n${block}`);
    }
  }
  assert.ok(straight > 0);
});

test("blocks that are more than one fence go through the parser", () => {
  for (const block of ["```math\na^2\n```\n", "```Math\nx", "text\n```js\nx\n```", "```js\nx\n```\ntext after", "    ```js\n    x\n    ```", "``` js `x`\ny\n```", "```js\r\nx\r\n```\r\n", "```c\\+\\+\nx\n```", "```a&amp;b\nx"]) {
    assert.equal(parseFenceBlock(block), null, block);
  }
});

test("generated fences and every prefix of them render straight as the parser would", () => {
  let seed = 1589;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (items) => items[Math.floor(random() * items.length)];
  const markers = ["```", "````", "~~~", "~~~~"];
  const infos = ["", "js", "Python title=x", "\tts", "mermaid", "c\\+\\+", "a&amp;b", "js `x`"];
  const lines = ["x = 1", "", "  indented", "\tTab", "```", "````", "~~~", " ```", "   ```  \t", "    ```", "```js", "~~~ js", "``", "$$", "- item", "> quote"];
  for (let k = 0; k < 300; k++) {
    const open = pick(markers);
    const doc = [pick(["", "", " "]) + open + pick(infos)];
    for (let n = Math.floor(random() * 5); n > 0; n--) doc.push(pick(lines));
    if (random() < 0.6) doc.push(pick(["", "  "]) + (random() < 0.8 ? open : pick(markers)) + pick(["", " ", "x"]));
    let markdown = [...doc, ...pick([[], [""], ["", ""], ["text"], ["", "text"]])].join("\n");
    if (random() < 0.15) markdown = markdown.replace(/\n/g, "\r\n");
    for (let end = 1; end <= markdown.length; end++) {
      const block = markdown.slice(0, end);
      const fence = parseFenceBlock(block);
      if (fence) assert.deepEqual(fence, parsedFence(block), JSON.stringify(block));
    }
  }
});
