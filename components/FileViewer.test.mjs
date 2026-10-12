import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("lightweight source rows are skipped for highlighted, diff, and preview views", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, filePath = "/tmp/file.txt") => {
      const isDelimitedTablePath = (path) => /\\.(csv|tsv)$/i.test(path);
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
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
  // A CSV/TSV table previews a loaded prefix too; markdown waits for the whole file.
  assert.equal(render({ ...large, truncated: true }, "preview", false, false, false, "/tmp/data.csv"), null);
  assert.equal(render({ ...large, language: "markdown", truncated: true }, "preview").length, 1_001);
  // A partly loaded HTML file previews too: the preview fetches it whole.
  assert.equal(render({ ...large, language: "html", truncated: true, size: 900 * 1024 }, "preview"), null);
  for (const mode of ["source", "diff", "preview"]) {
    const rows = render(large, mode);
    assert.equal(rows.length, 1_001, `${mode} must retain its source fallback`);
    assert.equal(rows[0].props["data-line-number"], 1);
    assert.equal(rows[0].props.children[1].props.children, "line");
  }
  assert.equal(render(large, "source", false, false, true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");
});

test("partly loaded HTML previews up to the HTML cap; partly loaded markdown does not", () => {
  const start = source.indexOf("  const hasPreview = ");
  const statement = source.slice(start, source.indexOf(";\n", start) + 1);
  const hasPreview = new Function("data", "isHtml", "isMarkdown", "isDelimitedTable", "HTML_PREVIEW_MAX_BYTES", `${statement}\nreturn hasPreview;`);
  const cap = 10 * 1024 * 1024;
  const partial = { truncated: true, size: 900 * 1024 };

  assert.equal(hasPreview(partial, true, false, false, cap), true);
  assert.equal(hasPreview({ ...partial, size: cap + 1 }, true, false, false, cap), false);
  assert.equal(hasPreview({ truncated: false, size: cap + 1 }, true, false, false, cap), true);
  assert.equal(hasPreview(partial, false, true, false, cap), false);
  assert.equal(hasPreview({ ...partial, size: cap + 1 }, false, false, true, cap), true);
});

test("the line-number gutter stays pinned while a wide line scrolls sideways", () => {
  // Evaluate the module's own style constants (the numbers in the highlighted,
  // plain and diff views all come from these) and the rendered lightweight
  // source rows, instead of matching the component's text.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constant = (name) => {
    const statement = file.statements.find((node) =>
      ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name,
      ),
    );
    assert.ok(statement, `${name} is declared in the module`);
    const { outputText } = ts.transpileModule(`${statement.getText(file)}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    return new Function(outputText)();
  };
  const codeStyle = constant("FILE_CODE_STYLE");
  const gutterStyle = constant("FILE_LINE_NUMBER_STYLE");

  // Render the source-view rows without mounting the file-fetching component,
  // with the real gutter style in place.
  const calculations = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer").body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, filePath = "/tmp/file.txt") => {
      const isDelimitedTablePath = (path) => /\.(csv|tsv)$/i.test(path);
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
      const FILE_LINE_NUMBER_STYLE = gutterStyle;
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", "gutterStyle", outputText)(React, (calculate) => calculate(), gutterStyle);
  const rows = render({ content: "line\n".repeat(1_000), language: "text" }, "source");
  const numberStyle = rows[0].props.children[0].props.style;

  // The gutter is a fixed column: pinned to the left edge of the viewer's
  // `overflow: auto` content box (the scroller in all three views), above the
  // tokens that slide behind it.
  assert.equal(numberStyle.position, "sticky");
  assert.equal(numberStyle.left, 0);
  assert.ok(numberStyle.zIndex >= 1, "the pinned gutter must stack above the scrolling text");
  // Sticky travels within its row, so every row must span the widest line.
  assert.equal(rows[0].props.style.minWidth, "100%");

  // The gutter repeats the code line's height in px, so a code-font change
  // without it puts the numbers off the line boxes they belong to.
  assert.equal(parseFloat(numberStyle.lineHeight), Number((codeStyle.fontSize * codeStyle.lineHeight).toFixed(1)));
});
