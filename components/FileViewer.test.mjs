import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

function sourceBlock(startText, endText) {
  const start = source.indexOf(startText);
  const end = endText ? source.indexOf(endText, start) : source.length;
  assert.notEqual(start, -1, `${startText} not found`);
  assert.notEqual(end, -1, `${endText} not found`);
  return source.slice(start, end);
}

test("large source previews bypass the per-line syntax highlighter inside one memoized tree", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  const block = sourceBlock("const SourceFileContent = memo", "const MarkdownFilePreview = memo");
  assert.match(block, /const sourceLines = useMemo\(\(\) => content\.split\("\\n"\), \[content\]\)/);
  assert.match(block, /if \(sourceLines\.length > SOURCE_HIGHLIGHT_MAX_LINES\)/);
  assert.match(block, /className="file-source-view is-lightweight"/);
  assert.match(block, /sourceLines\.map\(\(line, lineIndex\) =>/);
  assert.match(block, /className="file-source-line"/);
  assert.match(block, /className="file-source-line-content"/);
  assert.match(block, /<SyntaxHighlighter/);
  assert.ok(block.indexOf("if (sourceLines.length") < block.indexOf("<SyntaxHighlighter"));
});

test("diff and preview branches win before the memoized source fallback", () => {
  const block = sourceBlock("function TextFileViewer(", null);
  const diff = block.indexOf('effectiveDisplayMode === "diff"');
  const html = block.indexOf('isHtml && effectiveDisplayMode === "preview"', diff);
  const markdown = block.indexOf('isMarkdown && effectiveDisplayMode === "preview"', html);
  const sourceFallback = block.indexOf("<SourceFileContent", markdown);
  assert.ok(diff >= 0 && html > diff && markdown > html && sourceFallback > markdown);
  assert.match(block.slice(sourceFallback), /content=\{deferredSourceContent\}/);
});
