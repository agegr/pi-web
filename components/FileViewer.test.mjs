import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source previews bypass the per-line syntax highlighter", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  assert.match(source, /const useLightweightSource = lines\.length > SOURCE_HIGHLIGHT_MAX_LINES;/);

  const lightweightStart = source.indexOf(") : useLightweightSource ? (");
  const syntaxStart = source.indexOf("<SyntaxHighlighter", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(syntaxStart, -1);

  const lightweightSource = source.slice(lightweightStart, syntaxStart);
  assert.match(lightweightSource, /className="file-source-view is-lightweight"/);
  assert.match(lightweightSource, /className="file-source-plain-content"/);
  assert.match(lightweightSource, /<pre[\s\S]*?\{content\}[\s\S]*?<\/pre>/);
  assert.match(source, /function getSelectedPlainTextLineRange\(/);
});
