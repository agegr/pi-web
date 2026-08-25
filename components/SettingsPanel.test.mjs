import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("replaces the sidebar shortcuts with one settings entry", () => {
  assert.match(shellSource, /<SettingsPanel/);
  assert.match(shellSource, /translate\("common\.settings"\)/);
  assert.doesNotMatch(shellSource, /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/);
});

test("keeps every requested configuration surface inside the settings panel", () => {
  for (const section of ["general", "models", "skills", "agents", "plugins"]) {
    assert.match(panelSource, new RegExp(`id: "${section}"`));
  }
  for (const component of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(panelSource, new RegExp(`<${component} embedded`));
  }
});

test("restores the settings section and each list detail selection", async () => {
  assert.match(panelSource, /getLastSettingsSection\(cwd\)/);
  assert.match(panelSource, /setLastSettingsSection\(nextSection\)/);
  for (const name of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(
      await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
      /getLastSettingsSelection/,
    );
  }
});

test("keeps visited settings sections mounted and contains nested Escape handling", async () => {
  const modelsSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /mountedSections\.has\(id\)/);
  assert.match(panelSource, /hidden=\{section !== id\}/);
  assert.match(panelSource, /event\.defaultPrevented/);
  assert.match(modelsSource, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onClose\(\);/);
});

test("offers direct light, dark, and system theme selection", () => {
  for (const preference of ["light", "dark", "auto"]) {
    assert.match(panelSource, new RegExp(`id: "${preference}"`));
  }
  assert.match(panelSource, /setThemePreference\(option\.id\)/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
});

test("centers the sidebar settings label and keeps General free of divider rows", () => {
  assert.match(shellSource, /position: "relative", width: "100%"[\s\S]*?display: "grid", placeItems: "center"/);
  assert.match(shellSource, /aria-hidden="true" style=\{\{ position: "absolute", left: 10 \}\}/);
  assert.match(panelSource, /className="settings-dialog-header"/);
  assert.match(cssSource, /\.settings-dialog-header \{[\s\S]*?display: flex[\s\S]*?align-items: center[\s\S]*?min-height: 50px/);
  assert.doesNotMatch(panelSource, /sections\.find\(\(item\) => item\.id === section\)/);
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
});

test("uses top navigation on desktop and one compact section picker on mobile", () => {
  assert.match(panelSource, /className="settings-mobile-section-picker"/);
  assert.match(panelSource, /className="settings-section-tabs"/);
  assert.match(panelSource, /className="settings-section-tab"/);
  assert.match(cssSource, /\.settings-section-tab \{[\s\S]*?width: 96px/);
  assert.match(cssSource, /\.settings-section-icon \{[\s\S]*?flex-shrink: 0/);
  assert.match(cssSource, /\.settings-section-tab::after \{[\s\S]*?width: 24px/);
  assert.match(cssSource, /\.settings-section-tab\[aria-current="page"\]::after/);
  assert.match(cssSource, /\.settings-section-tab:focus-visible:not\(\[aria-current="page"\]\)/);
  assert.match(cssSource, /\.settings-section-tab:focus-visible\[aria-current="page"\][\s\S]*?outline: none/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-section-tabs \{[\s\S]*?display: none/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-mobile-section-picker \{[\s\S]*?display: block/);
  assert.doesNotMatch(panelSource, /width: isMobile \? "100%" : 188/);
  assert.match(panelSource, /<main className="settings-dialog-main">/);
  assert.doesNotMatch(panelSource, /<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
});

test("labels agent profiles as sub-agents", () => {
  assert.match(enSource, /"common\.agents": "Sub-agents"/);
  assert.match(enSource, /"agents\.new": "New sub-agent"/);
  assert.match(zhSource, /"common\.agents": "子代理"/);
  assert.match(zhSource, /"agents\.new": "新建子代理"/);
});

test("uses the child-session robot glyph for the sub-agents tab", () => {
  const robotGlyph = /<rect x="5" y="7" width="14" height="11" rx="2" \/>\s*<path d="M9 11h\.01M15 11h\.01M9 15h6M12 7V4M10 4h4" \/>/;
  assert.match(panelSource, robotGlyph);
  assert.match(sidebarSource, robotGlyph);
  assert.match(panelSource, /section === "agents"[\s\S]*?className="settings-section-icon is-agent"/);
  assert.match(cssSource, /\.settings-section-icon\.is-agent \{[\s\S]*?transform: scale\(1\.25\)/);
});
