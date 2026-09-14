import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

const WRITE_PATCH = [
  "diff --git a/report.html b/report.html",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/report.html",
  "@@ -0,0 +1,1 @@",
  "+hello",
].join("\n");

test("renders a button per file showing the basename and full path", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});

test("labels the chip as a turn-diff toggle instead of opening the file", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html", patch: WRITE_PATCH }],
    onOpenFile() {},
  });
  assert.match(html, /aria-label="Show Diff for report.html"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, />hello</);
});

test("keeps a separate control that opens the file", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html", patch: WRITE_PATCH }],
    onOpenFile() {},
  });
  assert.match(html, /aria-label="Open report.html"/);
});

test("shows an empty-state label when a chip has no patch", () => {
  const source = readFileSync(new URL("./TurnWrittenFiles.tsx", import.meta.url), "utf8");
  assert.match(source, /chat\.noTurnDiff/);
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }],
    onOpenFile() {},
  });
  assert.match(html, /aria-label="Show Diff for report.html"/);
});

test("stops the open-file control from toggling the turn diff", () => {
  const source = readFileSync(new URL("./TurnWrittenFiles.tsx", import.meta.url), "utf8");
  assert.match(source, /stopPropagation/);
  assert.match(source, /onOpenFile\?\.\(filePath\)/);
});

test("shows added and deleted line counts on each chip", () => {
  const html = render({
    files: [{
      filePath: "/abs/out/report.html",
      patch: WRITE_PATCH,
      additions: 4,
      deletions: 2,
    }],
    onOpenFile() {},
  });
  assert.match(html, />\+4</);
  assert.match(html, />-2</);
});

test("hides zero line counts", () => {
  const html = render({
    files: [{
      filePath: "/abs/out/report.html",
      patch: WRITE_PATCH,
      additions: 1,
      deletions: 0,
    }],
    onOpenFile() {},
  });
  assert.match(html, />\+1</);
  assert.doesNotMatch(html, />-0</);
});
