import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TabBar } = await jiti.import("./TabBar.tsx");

function renderTabBar(count) {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts` }));
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {} })));
}

/** The inline style of every element with that role, as property maps. */
function styles(html, role) {
  return [...html.matchAll(new RegExp(`<div role="${role}"[^>]* style="([^"]*)"`, "g"))].map(([, style]) =>
    Object.fromEntries(style.split(";").filter(Boolean).map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon), declaration.slice(colon + 1)];
    })));
}

test("tabs keep a fixed 36px bar and the native scrollbar is hidden", () => {
  // The native scrollbar used to take layout height inside the bar and squeeze
  // overflowing tabs (#1225); an overlay scrollbar replaces it.
  const html = renderTabBar(12);
  const [list] = styles(html, "tablist");
  assert.equal(list.height, "36px");
  assert.equal(list["overflow-x"], "auto");
  assert.equal(list["overflow-y"], "hidden");
  assert.equal(list["align-items"], "stretch");
  assert.match(html, /<div[^>]* role="tablist"[^>]*/);
  assert.match(html.match(/<div[^>]*role="tablist"[^>]*>/)[0], /class="tabbar-scroll"/);
  const tabs = styles(html, "tab");
  assert.equal(tabs.length, 12);
  for (const tab of tabs) {
    assert.equal(tab.height, undefined);
    assert.equal(tab["align-items"], "center");
  }
});

test("the overlay scrollbar sits outside the tablist and is aria-hidden", () => {
  const html = renderTabBar(12);
  const overlayAt = html.indexOf('class="tabbar-overlay"');
  assert.ok(overlayAt > html.lastIndexOf('role="tab"'));
  assert.match(html.match(/<div[^>]*class="tabbar-overlay"[^>]*>/)[0], /aria-hidden="true"/);
  // Close the tablist's own <div> and count back to zero before the overlay.
  const fromList = html.slice(html.search(/<div[^>]*role="tablist"/), overlayAt);
  let depth = 0;
  let closedAt = -1;
  for (const m of fromList.matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) { closedAt = m.index; break; }
  }
  assert.ok(closedAt >= 0, "the tablist closes before the overlay");
});
