import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

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

test("routes written files through the changed-file diff handler", async () => {
  const [messageView, appShell] = await Promise.all([
    readFile(new URL("./MessageView.tsx", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(messageView, /<TurnWrittenFiles files=\{writtenFiles\} onOpenFile=\{onOpenChangedFile \?\? onOpenFile\}/);
  assert.match(appShell, /const handleOpenChangedFile[\s\S]*?existing\?\.sourceSessionId === sourceSessionId[\s\S]*?modeHint: "diff"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});
