import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source previews bypass the per-line syntax highlighter", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  assert.match(source, /const useLightweightSource = sourceLines\.length > SOURCE_HIGHLIGHT_MAX_LINES/);

  // Both source trees are memoized so unrelated re-renders (panel open/close,
  // selection changes) reuse them instead of rebuilding every line element.
  assert.match(source, /const highlightedSource = useMemo\(/);

  const lightweightStart = source.indexOf("const lightweightSourceLines = useMemo(");
  const lightweightEnd = source.indexOf("[sourceLines, useLightweightSource, wrapLines]", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(lightweightEnd, -1);

  const lightweightSource = source.slice(lightweightStart, lightweightEnd);
  assert.match(lightweightSource, /useLightweightSource \? sourceLines\.map\(\(line, lineIndex\) =>/);
  assert.match(lightweightSource, /className="file-source-line"/);
  assert.match(lightweightSource, /className="file-source-line-content"/);
  assert.match(lightweightSource, /style=\{FILE_LINE_NUMBER_STYLE\}/);

  // The lightweight branch still wins over the syntax highlighter in the JSX.
  const branchStart = source.indexOf(") : useLightweightSource ? (");
  assert.notEqual(branchStart, -1);
  assert.match(source.slice(branchStart), /className="file-source-view is-lightweight"/);
  assert.notEqual(source.indexOf("highlightedSource", branchStart), -1);
});

test("the highlighted source view owns its <pre> background without a competing shorthand", () => {
  // vs colors <pre> with backgroundColor and vscDarkPlus with background; mixing
  // them across a theme switch warned and dropped the view's background.
  assert.match(source, /const fileViewerDarkTheme = \{\s*\.\.\.vscDarkPlus,\s*'pre\[class\*="language-"\]': \{\s*\.\.\.vscDarkPlus\['pre\[class\*="language-"\]'\],\s*\},\s*\};\ndelete fileViewerDarkTheme\['pre\[class\*="language-"\]'\]\.background;/);
  const start = source.indexOf("const highlightedSource = useMemo(");
  const element = source.slice(start, source.indexOf("</SyntaxHighlighter>", start));
  assert.match(element, /style=\{isDark \? fileViewerDarkTheme : vs\}/);
  const customStyle = element.slice(element.indexOf("customStyle={{"), element.indexOf("codeTagProps={{"));
  assert.match(customStyle, /backgroundColor: "var\(--bg\)"/);
  assert.doesNotMatch(customStyle, /\bbackground:/);
});

test("lightweight source rows are skipped for highlighted, diff, and preview views", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false) => {
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const FILE_LINE_NUMBER_STYLE = {};
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", outputText)(React, (calculate) => calculate());
  const large = { content: "line\n".repeat(1_000), language: "text" };

  assert.equal(render({ ...large, content: "line\n".repeat(999) }, "source"), null);
  assert.equal(render(large, "diff", true), null);
  assert.equal(render(large, "source", true, true), null);
  for (const language of ["html", "markdown"]) {
    assert.equal(render({ ...large, language }, "preview"), null);
  }
  for (const mode of ["source", "diff", "preview"]) {
    const rows = render(large, mode);
    assert.equal(rows.length, 1_001, `${mode} must retain its source fallback`);
    assert.equal(rows[0].props["data-line-number"], 1);
    assert.equal(rows[0].props.children[1].props.children, "line");
  }
  assert.equal(render(large, "source", false, false, true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");
});

test("markdown preview keeps app links and opens web and app links in a new tab (#1108)", () => {
  assert.match(source, /urlTransform=\{onOpenFile \? markdownUrlTransform : markdownAppUrlTransform\}/);
  assert.match(
    source,
    /return isExternalMarkdownHref\(href\)\s*\? <a href=\{href\} \{\.\.\.props\} target="_blank" rel="noopener noreferrer">\{children\}<\/a>\s*: <a href=\{href\} \{\.\.\.props\}>\{children\}<\/a>;/,
  );
});

test("markdown preview links carry PDF page fragments", () => {
  assert.match(source, /parsePdfPageFragment/);
  assert.match(source, /onOpenFile\(linkedFile, parsePdfPageFragment\(href\) \?\? undefined\)/);
});
