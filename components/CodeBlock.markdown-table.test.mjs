import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import reactSyntaxHighlighter from "react-syntax-highlighter";

// Rendered directly (not through CodeBlock/TextFileViewer) so the assertion
// holds without providers; both components share this exact highlighter.
const { Prism: SyntaxHighlighter } = reactSyntaxHighlighter;

const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const markdownTable = "| Name | Desc |\n| --- | --- |\n| A | first |";

test("Prism tags every markdown-table token with a `table` class", () => {
  // This class collides with Tailwind's `.table` display utility. If Prism
  // ever stops emitting it, the globals.css override below can be dropped.
  const html = renderToStaticMarkup(
    React.createElement(SyntaxHighlighter, { language: "markdown" }, markdownTable),
  );
  assert.match(html, /class="token table[ "]/);
});

test("globals.css keeps `table`-classed tokens inline despite Tailwind's utility", () => {
  // Without this override the utility's `display: table` stacks every pipe
  // and cell of a highlighted markdown table on its own line (#460).
  assert.match(cssSource, /span\.token\.table \{[^}]*display: inline;/);
});
