import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";

const { splitMarkdownBlocks } = await createJiti(import.meta.url).import("./markdown-blocks.ts");

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
