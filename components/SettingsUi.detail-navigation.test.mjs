import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ConfigDetailNavigationContext, ConfigSplitView } = await jiti.import("./SettingsUi.tsx");

const h = React.createElement;
const noop = () => {};
const uiSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

const splitView = (navigation) => renderToStaticMarkup(navigation
  ? h(ConfigDetailNavigationContext.Provider, { value: navigation }, h(ConfigSplitView, null, "rows"))
  : h(ConfigSplitView, null, "rows"));
const navigation = (detailOpen) => ({ detailOpen, openDetail: noop, closeDetail: noop, reportDetailTitle: noop });

test("inside Settings a split view says which pane a phone shows; elsewhere it stacks as before", () => {
  assert.equal(splitView(null), '<div class="config-split-view">rows</div>');
  assert.equal(splitView(navigation(false)), '<div class="config-split-view" data-pane="list">rows</div>');
  assert.equal(splitView(navigation(true)), '<div class="config-split-view" data-pane="detail">rows</div>');
  const phone = cssSource.match(/\.config-split-view\[data-pane="list"\] > \.config-detail,\s*\.config-split-view\[data-pane="detail"\] > \.config-sidebar \{\s*display: none;/);
  assert.ok(phone, "a phone hides the other pane");
});

test("a row or the add button opens the detail unless its handler prevented that", () => {
  for (const name of ["ConfigSidebarItem", "ConfigListAction"]) {
    const block = uiSource.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`))?.[0] ?? "";
    assert.match(block, /onClick=\{\(event\) => \{\s*onClick\?\.\(event\);\s*if \(!event\.defaultPrevented\) openDetail\(\);/, name);
    assert.match(block, /useReportDetailTitle\(active, ref\)/, name);
  }
});

test("a phone's Settings levels live in the history: Back goes up one, closing drops them", () => {
  const hook = panelSource.match(/function usePhoneSettingsLevel[\s\S]*?\n\}\n/)?.[0] ?? "";
  // The entry keeps Next's router state and the URL.
  assert.match(hook, /window\.history\.pushState\(window\.history\.state, ""\)/);
  assert.match(hook, /if \(pushedRef\.current > 0\) window\.history\.back\(\);/);
  assert.match(hook, /if \(pushed > 0\) window\.history\.go\(-pushed\);/);
  assert.match(panelSource, /const onClose = useCallback\(\(\) => \{\s*dropHistory\(\);\s*closeSettings\(\);/);
});

test("a phone's level change slides in by direction, before paint, and stands still under reduced motion", () => {
  const animate = panelSource.match(/function animatePhoneLevelChange[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.match(animate, /prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
  assert.match(animate, /const forward = PHONE_LEVEL_DEPTH\[to\] > PHONE_LEVEL_DEPTH\[from\];/);
  assert.match(animate, /translateX\(100%\)/, "going in comes from the right");
  assert.match(animate, /translateX\(-30%\)/, "going back comes from the left");
  assert.match(panelSource, /useLayoutEffect\(\(\) => \{\s*const from = shownPhoneLevelRef\.current;[\s\S]*?animatePhoneLevelChange\(mainRef\.current, headerRef\.current, from, phone\.level\);\s*\}, \[isPhone, phone\.level\]\);/);
});
