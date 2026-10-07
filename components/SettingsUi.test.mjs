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
  ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig", "McpConfig"].map(async (name) => [
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
    "ConfigSidebarGroupSwitch",
    "ConfigSidebarGroupStatus",
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
    "ConfigScopeTag",
    "ConfigScopeSwitch",
    "ConfigSaveTarget",
    "ConfigAddSourceHeading",
    "ConfigAddSourcePanel",
    "ConfigDetailGrid",
    "ConfigDetailGridRow",
    "ConfigFooterStatus",
    "ConfigNotice",
    "ConfigTrustNotice",
  ]) {
    assert.match(templateSource, new RegExp(`export function ${primitive}`));
  }
  assert.match(templateSource, /className="config-sidebar"/);
  assert.match(templateSource, /className="config-detail"/);
  assert.match(cssSource, /\.config-sidebar \{[\s\S]*?width: 240px/);
  assert.match(cssSource, /\.config-detail \{[\s\S]*?padding: 20px/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-sidebar \{[\s\S]*?width: 100%/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-detail \{[\s\S]*?padding: 14px/);
});

test("loads settings presentation from its dedicated stylesheet", () => {
  assert.match(layoutSource, /import "\.\/globals\.css";\s*import "\.\/settings\.css";/);
  assert.match(cssSource, /\.config-panel-root \{/);
  assert.match(cssSource, /\.settings-dialog-backdrop \{/);
  assert.doesNotMatch(globalCssSource, /\.config-panel-root \{/);
  assert.doesNotMatch(globalCssSource, /\.settings-dialog-backdrop \{/);
});

test("every settings section uses the shared list-detail layout", () => {
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "ConfigSplitView", "ConfigSidebar", "ConfigDetail", "ConfigFooter"]) {
      assert.match(source, new RegExp(`<${primitive}`), `${name} should use ${primitive}`);
    }
  }
});

test("all subpanel sidebars share one typography scale", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-sidebar-text \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 12px/);
  assert.match(cssSource, /\.config-sidebar-group-label \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 10px/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigSidebarText/);
  }
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig", "McpConfig"]) {
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

test("all shared config sidebar items use a fixed 30px height", () => {
  assert.match(cssSource, /\.config-sidebar-item \{[\s\S]*?height: 30px[\s\S]*?padding: 0 8px/);
  assert.match(cssSource, /\.config-list-action-button \{[\s\S]*?height: 30px[\s\S]*?min-height: 30px/);
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
  assert.match(cssSource, /\.config-detail-stack \{[\s\S]*?gap: 16px[\s\S]*?width: 100%/);
  assert.doesNotMatch(cssSource, /\.config-detail-stack \{[\s\S]*?max-width: 720px/);
  assert.match(cssSource, /\.config-field-label \{[\s\S]*?font-size: 11px/);
  assert.match(cssSource, /\.config-empty-state \{[\s\S]*?font-size: 12px/);
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
    "config-scope-switch",
    "config-save-target",
    "config-detail-grid",
    "config-add-source-input",
    "config-add-source-example",
    "config-footer-status-list",
    "config-notice",
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
  assert.match(cssSource, /\.config-button-default \{[\s\S]*?height: 32px/);
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

test("skills and plugins show reasons as visible text, never only as a tooltip", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "PluginsConfig"]) {
    // The unavailable project scope explains itself under the scope switch.
    assert.match(sources[name], /<ConfigSaveTarget[\s\S]*?disabledReason=\{t\("trust\.projectScopeUnavailable"\)\}/, name);
    assert.doesNotMatch(sources[name], /title=\{[^}]*(?:projectScopeUnavailable|openSessionToReload)/, name);
    assert.match(sources[name], /<ConfigTrustNotice message=\{t\("trust\.(?:skills|plugins)NotLoaded"\)\} \/>/, name);
    assert.doesNotMatch(sources[name], /className="config-trust-notice"/, name);
  }
  const plugins = sources.PluginsConfig;
  assert.match(plugins, /<div id=\{reloadReasonId\} className="config-detail-heading-note">\s*\{t\("i18n\.openSessionToReload"\)\}/);
  assert.match(plugins, /aria-describedby=\{sessionId \? undefined : reloadReasonId\}/);
  // Diagnostics open a list in the footer instead of a title.
  assert.match(plugins, /<ConfigFooterStatus[\s\S]*?details=\{data\.diagnostics\.map\(diagnosticText\)\}/);
  assert.doesNotMatch(plugins, /title=\{data\.diagnostics/);
});

test("every add pane chooses its scope in one place: the save target under its title", async () => {
  const sources = Object.fromEntries(configSources);
  const panes = {
    SkillsConfig: sources.SkillsConfig.match(/function AddSkillPanel[\s\S]*?\n\}\n/)?.[0] ?? "",
    PluginsConfig: sources.PluginsConfig.match(/function AddPluginPanel[\s\S]*?\n\}\n/)?.[0] ?? "",
    AgentsConfig: sources.AgentsConfig,
    McpAddServer: await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8"),
  };
  for (const [name, source] of Object.entries(panes)) {
    assert.ok(source, name);
    assert.match(source, /<ConfigSaveTarget[\s\S]*?label=\{t\("config\.saveTo"\)\}[\s\S]*?path=\{/, name);
    assert.doesNotMatch(source, /<ConfigScopeSwitch/, `${name} uses the shared row, not a switch of its own`);
  }
  // Skills and plugins: right under the title, before the box that searches or names the source.
  assert.match(panes.SkillsConfig, /t\("i18n\.addSkill"\)[^]*?<ConfigSaveTarget[^]*?placeholder=\{t\("i18n\.skillSearchPlaceholder"\)\}/);
  assert.match(panes.PluginsConfig, /target=\{\s*<ConfigSaveTarget/);
  assert.match(panes.SkillsConfig, /<ConfigAddSourceHeading[\s\S]*?target=\{\s*<ConfigSaveTarget/);
  assert.match(templateSource, /export function ConfigAddSourcePanel[\s\S]*?<ConfigAddSourceHeading/, "the add panel builds its heading from the same block");
  assert.match(panes.McpAddServer, /target=\{\s*<ConfigSaveTarget/);
  // Sub-agents: where a saved profile shows its scope tag, while creating; no hand-made switch beside it.
  assert.match(panes.AgentsConfig, /<ConfigDetailHeaderInfo>[\s\S]*?\{creating \? \(\s*<ConfigSaveTarget[\s\S]*?<ConfigScopeTag scope=\{displayedScope\}>/);
  assert.doesNotMatch(panes.AgentsConfig, /agents\.saveScope|setTargetScope\(scope\)\}\s*disabled=/);
  assert.match(cssSource, /\.config-save-target-path \{[\s\S]*?overflow-wrap: anywhere/);
  assert.doesNotMatch(cssSource, /config-add-source-location/);
});

test("plugin and skill panel words come from the locale files", () => {
  const sources = Object.fromEntries(configSources);
  const plugins = sources.PluginsConfig;
  for (const literal of [
    /Loading\.\.\./,
    /No plugins configured/,
    /label="Source"/,
    />\s*Examples\s*</,
    /"(?:Package|Session) (?:removed|installed|updated|disabled|enabled|reloaded)\."/,
    /diagnostic\{/,
    /\} ext · \$\{/,
    /\{group\.scope\}<|group: group\.scope \}/,
    /\{scope\}\s*<\/(?:span|button)>/,
  ]) {
    assert.doesNotMatch(plugins, literal);
  }
  assert.match(plugins, /\{scopeLabel\(group\.scope, t\)\}/);
  assert.match(plugins, /inputLabel=\{t\("config\.source"\)\}/);
  assert.match(plugins, /examplesLabel=\{t\("config\.examples"\)\}/);

  const skills = sources.SkillsConfig;
  for (const literal of [/label="(?:Source|Version|Name|Description)"/, /"No skills found"/, /: "unknown"/, /to discover and install skills/, /\{s\}\s*<\/button>/, /\{label\}\s*<\/span>/]) {
    assert.doesNotMatch(skills, literal);
  }
  // The catalog link sits at the right of the title, as in every add pane, and nowhere else.
  assert.match(skills, /<ConfigAddSourceHeading\s+title=\{t\("i18n\.addSkill"\)\}\s+catalogs=\{\[\{ href: "https:\/\/skills\.sh", label: "skills\.sh" \}\]\}/);
  assert.doesNotMatch(skills, /href="https:\/\/skills\.sh"|skills\.discoverHint/);
  for (const source of [enSource, zhSource]) {
    for (const key of ["config.source", "config.examples", "config.name", "config.saveTo", "plugins.diagnostic", "plugins.diagnostics"]) {
      assert.match(source, new RegExp(`"${key.replace(".", "\\.")}":`));
    }
    for (const status of ["loaded", "installed", "missing", "disabled"]) {
      assert.match(source, new RegExp(`"plugins\\.status\\.${status}":`));
    }
  }
});

test("the MCP panel's words come from the locale files, and its reasons are visible text", () => {
  const mcp = Object.fromEntries(configSources).McpConfig;
  for (const literal of [
    /Loading\.\.\./,
    /"(?:Global|Project|Code mode|Automatic|Always on|No servers)"/,
    />\s*(?:Global|Project|Code mode|Command|URL|Headers|Environment|Refresh)\s*</,
    /label="[A-Z][^"]*"/,
    /\{group\.scope\}</,
    /\{server\.scope\}</,
  ]) {
    assert.doesNotMatch(mcp, literal);
  }
  assert.match(mcp, /\{scopeLabel\(group\.scope, t\)\}/);
  assert.match(mcp, /<ConfigScopeTag scope=\{server\.scope\}>\{scopeLabel\(server\.scope, t\)\}<\/ConfigScopeTag>/);
  // Why a server does not connect is text on its row and in its accessible name, not only the dot, in the
  // words of whoever saw the state (a test, or an open session).
  assert.match(mcp, /aria-label=\{t\("mcp\.rowLabel", \{ name, state: t\(mcpRowStateLabelKey\(state, server\.status\)\) \}\)\}/);
  assert.match(mcp, /\{badgeKey && <span className=\{`mcp-sidebar-badge is-\$\{tone\}`\}>\{t\(badgeKey\)\}<\/span>\}/);
  // The panel's own title is the only one: no reason hides in a tooltip.
  assert.deepEqual(mcp.match(/\btitle=\{[^}]*\}/g), ['title={t("settings.mcp")}']);
  // The untrusted project's notice offers Trust (the page's trust dialog) through the shared block.
  assert.match(mcp, /<ConfigTrustNotice id=\{trustNoticeId\} message=\{trustMessage\} trustLabel=\{t\("mcp\.trust\.trustButton"\)\} onTrust=\{onTrust\} \/>/);
  // File problems open a list in the footer instead of a tooltip.
  assert.match(mcp, /<ConfigFooterStatus[\s\S]*?details=\{problems\.map\(/);
  for (const primitive of ["ConfigDetailGrid", "ConfigDetailGridRow", "ConfigScopeTag", "ConfigStatusDot", "ConfigNotice"]) {
    assert.match(mcp, new RegExp(`<${primitive}[ >]`), primitive);
  }
});

test("skills and plugins switch whole groups from the group heading, not from a bar", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "PluginsConfig"]) {
    const sidebar = sources[name].match(/<ConfigSidebar>[\s\S]*?<\/ConfigSidebar>/)?.[0] ?? "";
    // The switch sits in the heading row, so the list keeps all of its height.
    assert.match(sidebar, /<ConfigSidebarGroupLabel\s+aside=\{\s*<ConfigSidebarGroupSwitch/, name);
    assert.match(sidebar, /<ConfigSidebarGroupStatus /, name);
    assert.doesNotMatch(sidebar, /<ConfigButton/, name);
  }
  assert.doesNotMatch(templateSource, /ConfigSidebarBulkActions/);
  assert.doesNotMatch(cssSource, /config-sidebar-bulk/);
  assert.match(cssSource, /\.config-sidebar-group-label \{[\s\S]*?display: flex/);
  assert.match(cssSource, /\.config-switch \{[\s\S]*?width: 32px[\s\S]*?height: 18px/);
  assert.match(cssSource, /\.config-sidebar-group-status \{[\s\S]*?max-height: 4\.2em[\s\S]*?white-space: pre-wrap/);
});

test("Settings › MCP switches whole groups from the heading too, and a disabled switch points at its reason", () => {
  const mcp = Object.fromEntries(configSources).McpConfig;
  // The n/m count became the group switch, in the heading row, with what it left undone under it.
  assert.match(mcp, /<ConfigSidebarGroupLabel\n\s*aside=\{total > 0 \? \(\n\s*<ConfigSidebarGroupSwitch/);
  assert.match(mcp, /<ConfigSidebarGroupStatus note=\{statusText\.note\} error=\{statusText\.error\} \/>/);
  // MCP passes its own on rule (entries the switch never turns on do not hold it off); the others keep every row on.
  assert.match(templateSource, /checked=\{checked \?\? \(total > 0 && enabled === total\)\}/);
  assert.match(mcp, /checked=\{checked\}/);
  for (const name of ["SkillsConfig", "PluginsConfig"]) {
    const groupSwitch = Object.fromEntries(configSources)[name].match(/<ConfigSidebarGroupSwitch[\s\S]*?\/>/)?.[0] ?? "";
    assert.doesNotMatch(groupSwitch, /checked=/, name);
  }
  assert.doesNotMatch(mcp, /className="sr-only"/);
  // Why a control cannot be used is visible text it is described by, never only a tooltip.
  assert.match(templateSource, /export function ConfigSwitch\(\{[\s\S]*?describedBy,[\s\S]*?aria-describedby=\{describedBy\}/);
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch\(\{[\s\S]*?describedBy=\{describedBy\}/);
  assert.match(templateSource, /export function ConfigNotice\(\{ id, action, children \}[\s\S]*?<div id=\{id\} role="status"/);
  assert.match(templateSource, /export function ConfigTrustNotice\(\{\n\s*id,[\s\S]*?<ConfigNotice\n\s*id=\{id\}/);
  assert.match(mcp, /describedBy=\{block \? blockNoticeId : undefined\}/);
  assert.match(mcp, /<ConfigSwitch[\s\S]*?describedBy=\{note \? noteId : undefined\}/);
});
