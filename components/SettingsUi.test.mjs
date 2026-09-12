import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const configSources = await Promise.all(
  ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"].map(async (name) => [
    name,
    await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
  ]),
);

test("provides one template for config layout and controls", () => {
  for (const primitive of [
    "ConfigPanelShell",
    "ConfigSplitView",
    "ConfigSidebar",
    "ConfigSidebarGroupLabel",
    "ConfigSidebarItem",
    "ConfigSidebarText",
    "ConfigDetail",
    "ConfigDetailStack",
    "ConfigDetailHeader",
    "ConfigDetailHeaderInfo",
    "ConfigDetailActions",
    "ConfigDetailTitle",
    "ConfigSectionTitle",
    "ConfigField",
    "ConfigEmptyState",
    "ConfigFooter",
    "ConfigButton",
    "ConfigSwitch",
    "ConfigListAction",
    "ConfigStatusDot",
  ]) {
    assert.match(templateSource, new RegExp(`export function ${primitive}`));
  }
  assert.match(templateSource, /className="config-sidebar"/);
  assert.match(templateSource, /className="config-detail"/);
  assert.match(cssSource, /\.config-sidebar \{[\s\S]*?width: 240px/);
  assert.match(cssSource, /\.config-detail \{[^}]*min-width: 0[^}]*min-height: 0[^}]*padding: 28px[^}]*overflow-y: auto/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-sidebar \{[\s\S]*?width: 100%/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-detail \{[^}]*padding: 20px/);
});

test("loads settings presentation from its dedicated stylesheet", () => {
  assert.match(layoutSource, /import "\.\/globals\.css";\s*import "\.\/settings\.css";/);
  assert.match(cssSource, /\.config-panel-root \{/);
  assert.match(cssSource, /\.settings-dialog-backdrop \{/);
  assert.doesNotMatch(globalCssSource, /\.config-panel-root \{/);
  assert.doesNotMatch(globalCssSource, /\.settings-dialog-backdrop \{/);
});

test("all four settings sections use the shared list-detail layout", () => {
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "ConfigSplitView", "ConfigSidebar", "ConfigDetail", "ConfigFooter"]) {
      assert.match(source, new RegExp(`<${primitive}`), `${name} should use ${primitive}`);
    }
  }
});

test("all subpanel sidebars share one typography scale", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-sidebar-text \{[^}]*font-family: inherit[^}]*font-size: var\(--font-size-body\)/);
  assert.match(cssSource, /\.config-sidebar-group-label \{[^}]*font-family: inherit[^}]*font-size: var\(--font-size-small\)/);
  assert.match(globalCssSource, /--font-size-body: 14px/);
  assert.match(globalCssSource, /--font-size-small: 13px/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigSidebarText/);
  }
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarGroupLabel/);
  }
});

test("skills and sub-agents share interactive sidebar rows", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarItem/);
  }
  assert.match(templateSource, /export function ConfigSidebarItem[\s\S]*?className=\{\["config-sidebar-item"/);
  assert.match(cssSource, /\.config-sidebar-item:not\(:disabled\):hover,[\s\S]*?background: var\(--bg-hover\)/);
  assert.match(cssSource, /\.config-sidebar-item:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.doesNotMatch(templateSource, /setHovered|setFocusVisible|useState/);
  assert.doesNotMatch(sources.SkillsConfig, /onMouseEnter[\s\S]*?var\(--bg-hover\)/);
});

test("shared sidebar controls use the common touch target without fixing content height", () => {
  assert.match(globalCssSource, /--control-height: 40px/);
  assert.match(cssSource, /\.config-sidebar-item \{[^}]*height: auto[^}]*min-height: var\(--control-height\)/);
  assert.match(cssSource, /\.config-list-action-button \{[^}]*height: var\(--control-height\)[^}]*min-height: var\(--control-height\)/);
});

test("mobile empty lists collapse while populated sidebars remain scrollable", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-sidebar \{[^}]*height: auto[^}]*max-height: 176px/);
  assert.match(cssSource, /\.config-sidebar-list \{[^}]*min-height: 0[^}]*overflow-y: auto/);
  assert.match(cssSource, /\.config-sidebar:not\(:has\(\.config-sidebar-item\)\) \{[^}]*flex-direction: row/);
  assert.match(cssSource, /\.config-install-path \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
  assert.match(cssSource, /\.config-input \{[^}]*width: 100%[^}]*min-width: 0/);
});

test("plugin sidebar rows omit detail metadata", () => {
  const pluginSource = Object.fromEntries(configSources).PluginsConfig;
  const sidebarSource = pluginSource.match(/<ConfigSidebarList>[\s\S]*?<\/ConfigSidebarList>/)?.[0] ?? "";
  assert.match(sidebarSource, /<ConfigSidebarItem/);
  assert.match(sidebarSource, /<ConfigSidebarText[\s\S]*?\{pkg\.source\}/);
  assert.doesNotMatch(sidebarSource, /resourceSummary\(pkg|versionSummary\(pkg/);
});

test("skill scope group labels are localized", () => {
  const skillsSource = Object.fromEntries(configSources).SkillsConfig;
  for (const scope of ["global", "project", "path"]) {
    assert.match(skillsSource, new RegExp(`t\\("skills\\.scope\\.${scope}"\\)`));
    assert.match(enSource, new RegExp(`"skills\\.scope\\.${scope}":`));
    assert.match(zhSource, new RegExp(`"skills\\.scope\\.${scope}":`));
  }
  assert.match(zhSource, /"skills\.scope\.global": "全局"/);
  assert.match(zhSource, /"skills\.scope\.project": "项目"/);
});

test("all subpanel detail panes share one content hierarchy", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-detail-stack \{[^}]*gap: 24px[^}]*width: 100%[^}]*min-width: 0/);
  assert.doesNotMatch(cssSource, /\.config-detail-stack \{[\s\S]*?max-width: 720px/);
  assert.match(cssSource, /\.config-field-label \{[^}]*font-size: var\(--font-size-small\)/);
  assert.match(cssSource, /\.config-empty-state \{[^}]*font-size: var\(--font-size-body\)/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigDetailStack/);
    assert.match(source, /<ConfigEmptyState/);
  }
});

test("detail header actions keep buttons and switches aligned to the right", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-detail-actions \{[\s\S]*?justify-content: flex-end[\s\S]*?margin-left: auto/);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigDetailActions>/);
  }
  assert.match(sources.PluginsConfig, /<ConfigDetailActions>[\s\S]*?<ConfigSwitch[\s\S]*?<\/ConfigDetailActions>/);
});

test("keeps shared static presentation in the stylesheet", () => {
  assert.doesNotMatch(templateSource, /<style>/);
  assert.doesNotMatch(templateSource, /style=\{\{/);
  assert.doesNotMatch(templateSource, /onMouseEnter|onMouseLeave/);
  for (const className of [
    "config-panel-surface",
    "config-split-view",
    "config-sidebar-item",
    "config-detail-stack",
    "config-button",
    "config-switch",
  ]) {
    assert.match(templateSource, new RegExp(className));
    assert.match(cssSource, new RegExp(`\\.${className}\\b`));
  }
});

test("embedded sections do not repeat Settings close actions", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(sources.ModelsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.cancel"\)\}/);
  assert.match(sources.SkillsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
  assert.match(sources.PluginsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
});

test("subpanel footers share sizing while maintenance actions stay secondary", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-footer-actions \{[\s\S]*?justify-content: flex-end/);
  assert.match(cssSource, /\.config-footer-actions \.config-button-default \{[\s\S]*?min-width: 96px/);
  assert.match(cssSource, /\.config-button \{[\s\S]*?font-family: inherit/);
  assert.match(cssSource, /\.config-button-default \{[^}]*height: var\(--control-height\)/);
  assert.match(sources.ModelsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(sources.AgentsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{\(\) => void save\(\)\}/);
  assert.match(sources.SkillsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void checkForUpdates\(\)\}/);
  assert.match(sources.PluginsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void loadPlugins\(\)\}/);
});

test("skills, agents, and plugins share enabled and disabled controls", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSwitch/);
    assert.match(sources[name], /<ConfigStatusDot/);
  }
});
