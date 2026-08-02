import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ContextMenu } = await jiti.import("./ContextMenu.tsx");

function renderMenu(items, x = 100, y = 100) {
  return renderToStaticMarkup(
    React.createElement(ContextMenu, { x, y, items, onClose: () => {} }),
  );
}

test("renders all menu items", () => {
  const items = [
    { label: "Close", onClick: () => {} },
    { label: "Close Others", onClick: () => {} },
    { label: "Close All", onClick: () => {} },
  ];
  const html = renderMenu(items);

  assert.match(html, />Close</);
  assert.match(html, />Close Others</);
  assert.match(html, />Close All</);
  assert.match(html, /role="menu"/);
  assert.match(html, /role="menuitem"/);
});

test("marks disabled items", () => {
  const items = [
    { label: "Close", onClick: () => {} },
    { label: "Close Others", onClick: () => {}, disabled: true },
  ];
  const html = renderMenu(items);

  assert.match(html, /disabled=""/);
});
