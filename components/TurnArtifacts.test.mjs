import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnArtifacts } = await jiti.import("./TurnArtifacts.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(TurnArtifacts, props));
}

test("renders a chip per artifact showing the basename and absolute path", () => {
  const html = render({
    artifacts: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when there are no artifacts", () => {
  assert.equal(render({ artifacts: [], onOpenFile() {} }), "");
});
