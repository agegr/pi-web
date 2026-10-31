import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { SOURCE_LINE_HEIGHT } = await jiti.import("../lib/source-window.ts");

test("the source view renders and highlights a window, never every line", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isBinary", "isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "showingSource"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, filePath = "/tmp/file.txt") => {
      const isDelimitedTablePath = (path) => /\\.(csv|tsv)$/i.test(path);
      const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
      ${calculations}
      return showingSource;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const showingSource = new Function("React", "useMemo", outputText)(React, (calculate) => calculate());
  const large = { content: "line\n".repeat(50_000), language: "text" };

  // Only the line list is windowed; a diff and a rendered preview draw themselves.
  assert.equal(showingSource(large, "source"), true);
  assert.equal(showingSource(large, "diff", true), false);
  assert.equal(showingSource(large, "diff", false), true);
  for (const language of ["html", "markdown"]) {
    assert.equal(showingSource({ ...large, language }, "preview"), false);
  }
  assert.equal(showingSource({ ...large, truncated: true }, "preview", false, false, "/tmp/data.csv"), false);

  // The window is chosen by `highlightBlocks()` from the total line count and the
  // rendered range; nothing maps over every source line any more.
  assert.match(source, /highlightBlocks\(sourceLines\.length, sourceVirtual\.range\.start, sourceVirtual\.range\.end\)/);
  assert.match(source, /sourceBlocks\.map\(\(block\) => \(/);
  assert.doesNotMatch(source, /sourceLines\.map\(/);
  // A block tokenizes its context but renders only its own lines.
  assert.match(source, /rows=\{rendererProps\.rows\.slice\(contextLines\)\}/);
  assert.match(source, /startingLineNumber=\{start \+ 1\}/);
  // Find searches every loaded line, not the rendered window.
  assert.match(source, /findSourceMatches\(sourceLines, findQuery, findCaseSensitive\)/);
  assert.match(source, /scrollToSourceLine\(activeMatch\.line\)/);
  // The source view's own find bar, opened by the toolbar or the keyboard.
  assert.match(source, /className="file-find" role="search"/);
  assert.match(source, /stepFind\(event\.shiftKey \? -1 : 1\)/);
  // A truncated file is completed before find answers.
  assert.match(source, /SOURCE_SEARCH_MAX_BYTES/);
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

test("the line-number gutter is pinned in every view, and the window keeps it cheap", () => {
  // Evaluate the module's own style constants (the numbers in the diff view and
  // in each rendered source block all come from these), then check the Diff
  // view's rows and the source block's line-number style against them.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constants = (...names) => {
    const statements = names.map((name) => {
      const statement = file.statements.find((node) =>
        ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === name,
        ),
      );
      assert.ok(statement, `${name} is declared in the module`);
      return statement.getText(file);
    });
    const { outputText } = ts.transpileModule(`${statements.join("\n")}\nreturn [${names.join(", ")}];`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    return new Function(outputText)();
  };
  const [codeStyle, gutterStyle, pinnedStyle, maxRows] = constants("FILE_CODE_STYLE", "FILE_LINE_NUMBER_STYLE", "FILE_PINNED_LINE_NUMBER_STYLE", "SOURCE_HIGHLIGHT_MAX_LINES");

  // The source block hands the pinned gutter style to the highlighter it owns.
  assert.match(source, /lineNumberStyle=\{\{\s*\.\.\.FILE_PINNED_LINE_NUMBER_STYLE/);
  // The rows it renders are numbered from the block's own first line.
  assert.match(source, /firstLine=\{start \+ 1\}/);

  // The Diff view's first row number, with every row an added line.
  const diffView = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "DiffView");
  const { outputText: diffOutput } = ts.transpileModule(`return ${diffView.getText(file)}`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } });
  const diffNumberStyle = (rowCount) => {
    const added = Array.from({ length: rowCount }, (_, index) => ({ type: "added", text: "line", oldLineNo: null, newLineNo: index + 1 }));
    const DiffView = new Function("React", "useI18n", "diffLines", "SOURCE_HIGHLIGHT_MAX_LINES", "FILE_CODE_STYLE", "FILE_LINE_NUMBER_STYLE", "FILE_PINNED_LINE_NUMBER_STYLE", diffOutput)(
      React, () => ({ t: (key) => key }), () => added, maxRows, codeStyle, gutterStyle, pinnedStyle,
    );
    return DiffView({ patch: "" }).props.children[0].props.children[0].props.children[0].props.style;
  };

  // The pinned gutter is the same column in every view: pinned to the left edge
  // of the viewer's `overflow: auto` content box, above the tokens sliding behind it.
  for (const [key, value] of Object.entries(gutterStyle)) assert.equal(pinnedStyle[key], value, key);
  assert.equal(pinnedStyle.position, "sticky");
  assert.equal(pinnedStyle.left, 0);
  assert.ok(pinnedStyle.zIndex >= 1, "the pinned gutter must stack above the scrolling text");
  // Only a view that can hold more than SOURCE_HIGHLIGHT_MAX_LINES rows at once
  // drops it; the source view never renders that many.
  assert.equal(diffNumberStyle(maxRows), pinnedStyle);
  assert.equal(diffNumberStyle(maxRows + 1), gutterStyle);

  // The gutter repeats the code line's height in px, so a code-font change
  // without it puts the numbers off the line boxes they belong to.
  assert.equal(parseFloat(gutterStyle.lineHeight), Number((codeStyle.fontSize * codeStyle.lineHeight).toFixed(1)));
  // The window's own estimate of an unmeasured row is that same line box, so the
  // scrollbar starts out in step with the rows that replace it.
  assert.equal(SOURCE_LINE_HEIGHT, Number((codeStyle.fontSize * codeStyle.lineHeight).toFixed(1)));
});

test("find's matches are painted by the stylesheet, not by Prism's spans", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Both Custom Highlight rules live in the stylesheet, so the minifier and the
  // browser see the same CSS the component registers ranges against.
  assert.match(css, /::highlight\(pi-file-find\)\s*\{[^}]*background-color/);
  assert.match(css, /::highlight\(pi-file-find-active\)\s*\{[^}]*background-color/);
  // The bar itself floats over the source view, and goes full width on a phone.
  assert.match(css, /\.file-find\s*\{[^}]*position: absolute/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.file-find\s*\{/);
});
