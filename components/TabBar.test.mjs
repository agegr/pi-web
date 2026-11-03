import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TabBar } = await jiti.import("./TabBar.tsx");

function renderTabBar(count, onReorderTab) {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts` }));
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {}, onReorderTab })));
}

/** The inline style of every element with that role, as property maps. */
function styles(html, role) {
  return [...html.matchAll(new RegExp(`<div role="${role}"[^>]* style="([^"]*)"`, "g"))].map(([, style]) =>
    Object.fromEntries(style.split(";").filter(Boolean).map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon), declaration.slice(colon + 1)];
    })));
}

test("right-panel tabs can be dragged when a reorder handler is provided", () => {
  assert.match(renderTabBar(2, () => {}), /role="tab"[^>]*draggable="true"/);
  assert.doesNotMatch(renderTabBar(2), /role="tab"[^>]*draggable="true"/);
});

test("overflowing tabs keep the whole bar: the strip has no scrollbar", () => {
  // The app's 10px (6px on touch) scrollbar took its height out of the 36px
  // bar: 36px tabs were clipped (#1225), stretched ones squeezed to 26px.
  const html = renderTabBar(12);
  assert.match(html, /<div role="tablist" class="tabbar-scroll"/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.tabbar-scroll \{\s*scrollbar-width: none;\s*\}/);
  assert.match(css, /\.tabbar-scroll::-webkit-scrollbar \{\s*display: none;\s*\}/);
  const [list] = styles(html, "tablist");
  // The bar's height (36px, 44px on a phone or touch screen).
  assert.equal(list.height, "var(--top-bar-height)");
  assert.equal(list["overflow-x"], "auto");
  assert.equal(list["overflow-y"], "hidden");
  assert.equal(list["align-items"], "stretch");
  const tabs = styles(html, "tab");
  assert.equal(tabs.length, 12);
  for (const tab of tabs) {
    assert.equal(tab.height, undefined);
    assert.equal(tab["align-items"], "center");
  }
});
