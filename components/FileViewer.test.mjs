import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** The module's own top-level functions and constants of these names, as source text. */
function declarations(...names) {
  return names.map((name) => {
    const node = sourceFile.statements.find((statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name,
      )),
    );
    assert.ok(node, `${name} is declared in the module`);
    return node.getText(sourceFile);
  }).join("\n");
}

test("lightweight source rows are skipped for highlighted, diff, and preview views", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isBinary", "isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    ${declarations("sourceLineClassName")}
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, filePath = "/tmp/file.txt", targetLines = undefined) => {
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
  // A binary file has no Preview, whatever its extension (#1401).
  assert.equal(render({ ...large, binary: true }, "preview", false, false, false, "/tmp/data.csv").length, 1_001);
  assert.equal(render({ ...large, language: "html", binary: true }, "preview").length, 1_001);
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

  // A link's lines are marked, and only those.
  const marked = render({ ...large, content: "line\n".repeat(1_200) }, "source", false, false, false, "/tmp/file.txt", { start: 10, end: 12 })
    .filter((row) => row.props.className.includes("is-link-target"))
    .map((row) => row.props["data-line-number"]);
  assert.deepEqual(marked, [10, 11, 12]);
});

test("the diff view wraps when the viewer wraps, and the key reaches the diff", () => {
  const diffView = source.slice(source.indexOf("function DiffView"), source.indexOf("function ImageViewer"));
  assert.notEqual(source.indexOf("function DiffView"), -1);

  // Wrapped: the box stops being the widest line's width and the row's text
  // column gives way instead of pushing a horizontal scrollbar.
  assert.match(diffView, /width: wrapLines \? "100%" : "max-content"/);
  assert.match(diffView, /whiteSpace: wrapLines \? "pre-wrap" : "pre"/);
  assert.match(diffView, /overflowWrap: wrapLines \? "anywhere" : "normal"/);
  assert.match(diffView, /flexShrink: wrapLines \? 1 : 0/);
  // Unwrapped stays exactly as before: one line per row, sideways scroll. The
  // +/- marker column never shrinks either way.
  assert.match(diffView, /padding: "0 6px",[\s\S]{0,160}flexShrink: 0/);
  assert.match(source, /<MemoizedDiffView[\s\S]{0,200}patch=\{gitDiff\.patch!\}[\s\S]{0,200}wrapLines=\{wrapLines\}[\s\S]{0,200}language=\{language\}[\s\S]{0,200}prismReady=\{prismReady\}[\s\S]{0,200}isDark=\{isDark\}[\s\S]{0,200}\/>/);

  // The wrap control is offered for the diff as well as the source, never for a
  // rendered preview (markdown, HTML, table), where there are no lines to wrap.
  assert.match(source, /\(effectiveDisplayMode === "source" \|\| \(effectiveDisplayMode === "diff" && diffLayout === "stacked"\)\) && !isBinary/);
});

test("a highlighted diff line keeps the row's line box, wrap and background", () => {
  const lineCode = source.slice(source.indexOf("function DiffLineCode"), source.indexOf("function DiffView"));
  assert.notEqual(source.indexOf("function DiffLineCode"), -1);
  const customStyle = lineCode.slice(lineCode.indexOf("customStyle={{"), lineCode.indexOf("}}", lineCode.indexOf("customStyle={{")));
  // The theme's <pre> rules land on the inline wrapper: vs draws a border, both
  // set their own font and `white-space: pre`, which grew every row by a pixel
  // or two and kept a wrapped long line on one row.
  for (const rule of [/border: 0/, /fontFamily: "inherit"/, /lineHeight: "inherit"/, /whiteSpace: "inherit"/]) {
    assert.match(customStyle, rule);
  }
  // vs colors <pre> with backgroundColor: the shorthand beside it left a white
  // box behind each line after a dark-to-light switch (as #1060 in the source view).
  assert.match(customStyle, /backgroundColor: "transparent"/);
  assert.doesNotMatch(customStyle, /\bbackground:/);
  // The code span's own white-space comes from the highlighter.
  assert.match(lineCode, /wrapLongLines=\{wrapLines\}/);
  // Unrelated renders reuse the tokens instead of running Prism on every line.
  assert.match(source, /const DiffLineCode = memo\(function DiffLineCode/);
  assert.match(source, /const MemoizedDiffView = memo\(DiffView\);/);
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

test("the line-number gutter is pinned only in views of at most SOURCE_HIGHLIGHT_MAX_LINES rows", () => {
  // Evaluate the module's own style constants (the numbers in the highlighted,
  // plain and diff views all come from these), the highlighted and lightweight
  // source elements and the Diff view's rows, instead of matching the
  // component's text.
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

  // Build the source views without mounting the file-fetching component, with
  // the real gutter styles in place.
  const calculations = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer").body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isBinary", "isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines", "prismReady", "highlightedSource"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    ${declarations("sourceLineClassName")}
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, filePath = "/tmp/file.txt", targetLines = undefined) => {
      const isDelimitedTablePath = (path) => /\.(csv|tsv)$/i.test(path);
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
      const FILE_LINE_NUMBER_STYLE = gutterStyle;
      const FILE_PINNED_LINE_NUMBER_STYLE = pinnedStyle;
      // Stand-ins for what the highlighted element only passes on.
      const [usePrismLanguages, SyntaxHighlighter, SourceCodeRenderer, isDark, vs, fileViewerDarkTheme, FILE_CODE_STYLE] = [() => true, "pre", "span", false, {}, {}, {}];
      ${calculations}
      return { lightweightSourceLines, highlightedSource };
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", "gutterStyle", "pinnedStyle", outputText)(React, (calculate) => calculate(), gutterStyle, pinnedStyle);
  const { lightweightSourceLines: rows, highlightedSource } = render({ content: "line\n".repeat(1_000), language: "text" }, "source");
  const numberStyle = rows[0].props.children[0].props.style;
  // The Diff view's first row number, with every row an added line.
  const diffView = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "DiffView");
  const { outputText: diffOutput } = ts.transpileModule(`${declarations("DIFF_CONTEXT", "collapseDiff", "DIFF_ADDED_BACKGROUND", "DIFF_REMOVED_BACKGROUND", "diffChangeBackground", "diffChangeBorder")}\nreturn ${diffView.getText(file)}`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } });
  const diffNumberStyle = (rowCount) => {
    const added = Array.from({ length: rowCount }, (_, index) => ({ type: "added", text: "line", oldLineNo: null, newLineNo: index + 1 }));
    const DiffView = new Function("React", "useI18n", "diffLines", "SOURCE_HIGHLIGHT_MAX_LINES", "FILE_CODE_STYLE", "FILE_LINE_NUMBER_STYLE", "FILE_PINNED_LINE_NUMBER_STYLE", diffOutput)(
      React, () => ({ t: (key) => key }), () => added, maxRows, codeStyle, gutterStyle, pinnedStyle,
    );
    return DiffView({ patch: "" }).props.children[0].props.children[0].props.children[0].props.style;
  };

  // The pinned gutter is the same column, pinned to the left edge of the
  // viewer's `overflow: auto` content box above the tokens that slide behind it.
  for (const [key, value] of Object.entries(gutterStyle)) assert.equal(pinnedStyle[key], value, key);
  assert.equal(pinnedStyle.position, "sticky");
  assert.equal(pinnedStyle.left, 0);
  assert.ok(pinnedStyle.zIndex >= 1, "the pinned gutter must stack above the scrolling text");
  // Views of at most SOURCE_HIGHLIGHT_MAX_LINES rows pin it: the highlighted
  // Source view (never longer) and a diff up to that many rows.
  assert.deepEqual(highlightedSource.props.lineNumberStyle, pinnedStyle);
  assert.equal(diffNumberStyle(maxRows), pinnedStyle);
  assert.equal(diffNumberStyle(maxRows + 1), gutterStyle);
  // The plain fallback has more rows than that by definition, and the browser
  // repositions every sticky cell on each scroll: its numbers stay unpinned.
  assert.equal(numberStyle, gutterStyle);
  assert.equal(numberStyle.position, undefined);

  // The gutter repeats the code line's height in px, so a code-font change
  // without it puts the numbers off the line boxes they belong to.
  assert.equal(parseFloat(numberStyle.lineHeight), Number((codeStyle.fontSize * codeStyle.lineHeight).toFixed(1)));
});

test("the split diff sets each old line beside the line that replaced it", async () => {
  const { parseUnifiedPatch } = await import("../lib/patch.ts");
  const { outputText } = ts.transpileModule(`
    ${declarations("diffRows", "DIFF_CONTEXT", "collapseDiff", "DIFF_ADDED_BACKGROUND", "DIFF_REMOVED_BACKGROUND", "diffChangeBackground", "diffChangeBorder", "SplitDiffView")}
    return SplitDiffView;
  `, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } });
  const SplitDiffView = new Function("React", "useI18n", "parseUnifiedPatch", "DiffGapMarker", "DiffLineCode", "SOURCE_HIGHLIGHT_MAX_LINES", "FILE_CODE_STYLE", "FILE_LINE_NUMBER_STYLE", outputText)(
    React, () => ({ t: (key) => key }), parseUnifiedPatch, "gap", "code", 1_000, {}, {},
  );
  const patch = [
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,3 +1,4 @@",
    " keep",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
    "+added",
    " end",
  ].join("\n");
  const view = SplitDiffView({ patch, language: "text", prismReady: false, isDark: false });
  const cells = view.props.children;
  const text = (cell) => cell.props.children[2].props.children;
  const number = (cell) => cell.props.children[0].props.children;
  // Two cells a row: left the old file, right the new one.
  assert.deepEqual(cells.map(text), ["keep", "keep", "old one", "new one", "old two", "new two", " ", "added", "end", "end"]);
  assert.deepEqual(cells.map(number), [1, 1, 2, 2, 3, 3, "", 4, 4, 5]);

  // Two equal halves of the box, lines wrapping inside them: an unwrapped
  // column as wide as the longest line pushed the new side off a narrow panel.
  assert.equal(view.props.style.gridTemplateColumns, "minmax(0, 1fr) minmax(0, 1fr)");
  assert.equal(view.props.style.width, undefined);
  assert.equal(cells[0].props.children[2].props.style.whiteSpace, "pre-wrap");
});

test("the diff takes two columns only where the viewer's own box has room for them", () => {
  // The box's width decides, never the window's: a desktop window holds a file
  // panel as narrow as a phone.
  assert.match(source, /setLayout\(box\.clientWidth >= SPLIT_DIFF_MIN_WIDTH \? "split" : "stacked"\)/);
  assert.match(source, /const diffLayout = useDiffLayout\(contentBox\);/);
  assert.match(source, /ref=\{attachContentBox\}\s+className="file-viewer-content"/);
  assert.match(source, /<MemoizedDiffView[\s\S]{0,400}layout=\{diffLayout\}[\s\S]{0,40}\/>/);
  // The panel's default width on a desktop (at least 360px, 42% of the window:
  // 538px at 1280) splits; a phone's 390px panel does not.
  const [minWidth] = new Function(`${ts.transpileModule(declarations("SPLIT_DIFF_MIN_WIDTH"), {}).outputText}\nreturn [SPLIT_DIFF_MIN_WIDTH];`)();
  assert.ok(minWidth <= 0.42 * 1280 && minWidth > 390);
});

test("a link's chunks stop loading by themselves once one fails", () => {
  // Each failed chunk ends `loadingMore`, which re-runs the effect at the same
  // offset: without the error guard it asked hundreds of times a second.
  const effect = source.match(/\/\/ Load more by itself[\s\S]*?\}, \[[^\]]*\]\);/)?.[0];
  assert.ok(effect, "the auto-load effect is found");
  assert.match(effect, /if \([^)]*\berror\b[^)]*\) return;/);
  assert.match(effect, /\}, \[[^\]]*\berror\b[^\]]*\]\);$/);
});
