import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
// The sub-agents panel draws child sessions with the same robot glyph.
const agentSessionPanelSource = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");
const themeOptionsSource = await readFile(new URL("../lib/theme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const stackedDialogSource = await readFile(new URL("../lib/stacked-dialog.ts", import.meta.url), "utf8");

test("opens one settings panel from direct sidebar shortcuts", () => {
  assert.match(shellSource, /<SettingsPanel/);
  assert.match(shellSource, /setSettingsSection\(section\)/);
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.match(shellSource, /translate\("common\.settings"\)/);
  assert.match(shellSource, /<SettingsSectionIcon section=\{section\} size=\{14\} strokeWidth=\{2\} \/>\s*<span>\{label\}<\/span>/);
  assert.match(shellSource, /<SettingsSectionIcon section="general" size=\{14\} strokeWidth=\{2\} \/>/);
  assert.doesNotMatch(shellSource, /\["plugins", translate\("common\.plugins"\)\]/);
  assert.doesNotMatch(shellSource, /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/);
});

test("keeps every requested configuration surface inside the settings panel", () => {
  for (const section of ["general", "models", "skills", "agents", "plugins", "mcp"]) {
    assert.match(panelSource, new RegExp(`id: "${section}"`));
  }
  for (const component of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig", "McpConfig"]) {
    assert.match(panelSource, new RegExp(`<${component} embedded`));
  }
});

test("Settings › MCP works without a project, and only project sections fall back to General", () => {
  // Mounted with or without a cwd, and remounted when the project changes.
  assert.match(panelSource, /\{sectionHost\("mcp", <McpConfig embedded key=\{cwd \?\? ""\} cwd=\{cwd\} [^\n]*onClose=\{onClose\} \/>\)\}/);
  assert.doesNotMatch(panelSource, /cwd && sectionHost\("mcp"/);
  // Which sections need a project is decided once, in settings-navigation.
  assert.match(panelSource, /requiresProject: settingsSectionRequiresProject\(item\.id\)/);
  assert.match(panelSource, /const sectionRequiresProject = settingsSectionRequiresProject\(section\);/);
  assert.match(panelSource, /if \(cwd \|\| !sectionRequiresProject\) return;/);
  assert.doesNotMatch(panelSource, /section !== "skills" && section !== "agents"/);
  // The sidebar shortcuts ask the same function instead of naming sections by hand.
  assert.match(shellSource, /const disabled = settingsSectionRequiresProject\(section\) && !projectTrustCwd;/);
  assert.doesNotMatch(shellSource, /section !== "models"/);
  // Its own glyph, not the Plugins fallback.
  assert.match(panelSource, /if \(section === "mcp"\) return <svg \{\.\.\.common\}>/);
  for (const source of [enSource, zhSource]) assert.match(source, /"settings\.mcp": "MCP"/);
});

test("restores the settings section and each list detail selection", async () => {
  assert.match(shellSource, /getLastSettingsSection\(projectTrustCwd\)/);
  assert.match(panelSource, /setLastSettingsSection\(initialSection\)/);
  assert.match(panelSource, /setLastSettingsSection\(nextSection\)/);
  for (const name of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig", "McpConfig"]) {
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
  // Settings closes on an Escape nothing nearer handled (lib/stacked-dialog.test.mjs pins the phases).
  assert.match(panelSource, /useEffect\(\(\) => listenForPanelEscape\(document, onClose\), \[onClose\]\);/);
  assert.doesNotMatch(panelSource, /addEventListener\("keydown"/);
  // An Escape that cancels an IME composition is the input method's, not a request to close.
  assert.match(stackedDialogSource, /if \(event\.key !== "Escape" \|\| event\.defaultPrevented \|\| cancelsComposition\(event\)\) return;/);
  assert.match(modelsSource, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onClose\(\);/);
});

test("focus moves into Settings as it opens and back to its opener as it closes", () => {
  // Left on the composer a bare /mcp opened Settings from, Escape stopped a running agent
  // and Settings stayed open (lib/stacked-dialog.test.mjs runs focusModalPanel()).
  assert.match(panelSource, /const dialogRef = useRef<HTMLDivElement>\(null\);\n\s*useLayoutEffect\(\(\) => focusModalPanel\(document, dialogRef\.current, \{\n\s*restoreTextEntry: !window\.matchMedia\?\.\("\(pointer: coarse\)"\)\.matches,\n\s*\}\), \[\]\);/);
  assert.match(panelSource, /<div\n\s*ref=\{dialogRef\}\n\s*role="dialog"\n\s*aria-modal="true"\n\s*aria-label=\{t\("settings\.title"\)\}\n\s*tabIndex=\{-1\}/);
  // The dialog element is not a control: no focus ring around the whole page.
  assert.match(cssSource, /\.settings-dialog-backdrop:focus \{\n\s*outline: none;\n\}/);
});

test("Settings › MCP offers Trust through the page's trust dialog, which opens above Settings", () => {
  // AppShell owns trust: its status and its dialog opener go through SettingsPanel to McpConfig.
  assert.match(shellSource, /<SettingsPanel[\s\S]*?projectTrust=\{projectTrust\}\n\s*onOpenTrustDialog=\{openProjectTrustDialog\}[\s\S]*?\/>/);
  assert.match(panelSource, /<McpConfig embedded key=\{cwd \?\? ""\} cwd=\{cwd\} trust=\{projectTrust\} onTrustProject=\{onOpenTrustDialog\} onProjectTrustChanged=\{onProjectTrustChanged\} onClose=\{onClose\} \/>/);
  // The banner and Settings open the same dialog, for the same folder Settings shows.
  assert.match(shellSource, /const openProjectTrustDialog = useCallback\(\(\) => \{\n\s*setProjectTrustError\(null\);\n\s*setProjectTrustDialogOpen\(true\);\n\s*\}, \[\]\);/);
  assert.match(shellSource, /onClick=\{openProjectTrustDialog\}/);
  assert.match(shellSource, /<SettingsPanel\n\s*cwd=\{projectTrustCwd\}/);
  assert.match(shellSource, /<ProjectTrustDialog\n\s*cwd=\{projectTrustCwd\}/);
  // Rendered after Settings and stacked above it.
  assert.ok(shellSource.indexOf("<ProjectTrustDialog") > shellSource.indexOf("<SettingsPanel"));
  const zIndex = (selector) => Number(cssSource.match(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+);`))?.[1]);
  assert.ok(zIndex(".project-trust-backdrop") > zIndex(".settings-dialog-backdrop"));
  // Escape there closes only the dialog: ProjectTrustDialog.test.mjs and lib/stacked-dialog.test.mjs.
});

test("an Add in Settings › MCP hands the folder's new trust to the page, which every section reloads on", () => {
  // Adding a project server writes .pi/mcp.json (the folder now requires trust) and may trust a
  // fresh folder in the same step; the page takes that status only for the folder Settings shows.
  assert.match(shellSource, /<SettingsPanel[\s\S]*?onProjectTrustChanged=\{handleProjectTrustChanged\}[\s\S]*?\/>/);
  assert.match(shellSource, /const handleProjectTrustChanged = useCallback\(\(cwd: string, status: ProjectTrustStatus\) => \{\n\s*if \(cwd === projectTrustCwd\) setProjectTrust\(status\);\n\s*\}, \[projectTrustCwd\]\);/);
  // Nothing was rebuilt on the server, so the chat keeps its session key.
  const handler = shellSource.slice(shellSource.indexOf("const handleProjectTrustChanged"), shellSource.indexOf("}, [projectTrustCwd]);", shellSource.indexOf("const handleProjectTrustChanged")));
  assert.doesNotMatch(handler, /setSessionKey|setModelsRefreshKey/);
});

test("trusting from Settings › MCP reloads, in place, the other mounted sections whose answer depends on trust", async () => {
  // Visited sections stay mounted (hidden), so each one that reads trust takes the page's
  // status. Still keyed by cwd alone: a remount would drop an install under way or a draft.
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(panelSource, new RegExp(`<${name} embedded key=\\{cwd\\} cwd=\\{cwd\\}[^\\n]*? trust=\\{projectTrust\\} `), name);
  }
  const read = (name) => readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8");
  const [skills, plugins, agents] = await Promise.all(["SkillsConfig", "PluginsConfig", "AgentsConfig"].map(read));
  // Skills and Plugins report "not loaded" and disable the Project scope from the trust at load
  // time: a new decision loads the list again, keeping the selection and update checks; the
  // first load stays the cwd effect's.
  for (const [src, load] of [[skills, "loadSkills"], [plugins, "loadPlugins"]]) {
    assert.match(src, new RegExp(
      "const trustKey = projectTrustReloadKey\\(trust\\);\\n\\s*const loadedTrustKeyRef = useRef\\(trustKey\\);\\n\\s*useEffect\\(\\(\\) => \\{\\n"
      + "\\s*if \\(loadedTrustKeyRef\\.current === trustKey\\) return;\\n\\s*loadedTrustKeyRef\\.current = trustKey;\\n"
      + `\\s*void ${load}\\(\\);\\n\\s*\\}, \\[trustKey, ${load}\\]\\);`,
    ), load);
  }
  // Agents: only the model list (GET /api/models leaves out an untrusted project's extensions).
  assert.match(agents, /const response = await fetch\(`\/api\/models\?cwd=\$\{encodeURIComponent\(cwd\)\}`[\s\S]*?\}, \[cwd, trustKey\]\);/);
  // Models reads models.json, auth and enabledModels, none of which follows trust.
  assert.match(panelSource, /sectionHost\("models", <ModelsConfig embedded cwd=\{cwd\} onClose=\{onClose\} \/>\)/);
});

test("offers five palettes and system theme selection with native radios", () => {
  for (const preference of ["light", "dark", "mist", "rose", "pine", "auto"]) {
    assert.match(themeOptionsSource, new RegExp(`id: "${preference}"`));
  }
  assert.match(panelSource, /THEME_OPTIONS\.map/);
  assert.match(panelSource, /type="radio"/);
  assert.match(panelSource, /setThemePreference\(option\.id\)/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
});

test("keeps language selection in General settings", () => {
  assert.match(panelSource, /t\("common\.language"\)/);
  assert.match(panelSource, /className="settings-language-options"/);
  assert.match(panelSource, /setLocale\(plugin\.id/);
});

test("groups fonts, chat font size and width in one section, chat behavior in another, without row backgrounds", () => {
  const appearanceSection = panelSource.slice(
    panelSource.indexOf('{t("settings.appearance")}'),
    panelSource.indexOf('{t("settings.typography")}'),
  );
  const typographySection = panelSource.slice(
    panelSource.indexOf('{t("settings.typography")}'),
    panelSource.indexOf('{t("settings.chat")}'),
  );
  const chatSection = panelSource.slice(
    panelSource.indexOf('{t("settings.chat")}'),
    panelSource.indexOf('{t("settings.sidebar")}'),
  );

  assert.doesNotMatch(appearanceSection, /settings-chat-content|<FontSettings/);
  assert.match(typographySection, /className="settings-chat-options"[\s\S]*<FontSettings \/>/);
  assert.equal((typographySection.match(/className="settings-chat-option settings-chat-range-option"/g) ?? []).length, 2);
  for (const key of ["chatContentWidth", "chatContentFontSize", "fontDescription"]) {
    assert.match(typographySection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.match(chatSection, /className="settings-chat-options"/);
  assert.doesNotMatch(chatSection, /settings-chat-content/);
  assert.equal((chatSection.match(/className="settings-chat-option(?: |")/g) ?? []).length, 3);
  assert.equal((chatSection.match(/<ConfigSwitch/g) ?? []).length, 2);
  for (const key of ["thinkingExpandedDefault", "quoteSelection", "enterSendMode", "enterSendModeEnter", "enterSendModeCtrlEnter"]) {
    assert.match(chatSection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.doesNotMatch(panelSource, /ThinkingIcon|settings-thinking-/);
  const chatOptionStyles = cssSource.match(/\.settings-chat-option \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(chatOptionStyles, /font-size: 12px/);
  assert.doesNotMatch(chatOptionStyles, /background/);
});

test("General's Sidebar section picks where the file browser goes, as the send key's options look", () => {
  const sidebarSection = panelSource.slice(
    panelSource.indexOf('{t("settings.sidebar")}'),
    panelSource.indexOf("{shellSettings?.isWindows"),
  );
  // After Chat, before the Windows-only shell section.
  assert.ok(panelSource.indexOf('{t("settings.chat")}') < panelSource.indexOf('{t("settings.sidebar")}'));
  assert.match(sidebarSection, /className="settings-chat-option settings-chat-switch-option"\n\s*role="radiogroup"\n\s*aria-label=\{t\("settings\.filesPlacement"\)\}\n\s*aria-describedby="settings-files-placement-description"/);
  assert.equal((sidebarSection.match(/className="settings-send-mode-option"/g) ?? []).length, 2);
  for (const placement of ["below", "tab"]) {
    assert.match(sidebarSection, new RegExp(`checked=\\{filesPlacement === "${placement}"\\}\\n\\s*onChange=\\{\\(\\) => setFilesPlacement\\("${placement}"\\)\\}`));
  }
  // The note on phones sits under the options and describes the group.
  assert.match(sidebarSection, /<\/div>\n\s*<p id="settings-files-placement-description" className="settings-general-description">\{t\("settings\.filesPlacementDescription"\)\}<\/p>/);
  assert.match(cssSource, /\.settings-chat-options \+ \.settings-general-description \{\n\s*margin: 6px 0 0;/);
  for (const source of [enSource, zhSource]) {
    for (const key of ["sidebar", "filesPlacement", "filesPlacementBelow", "filesPlacementTab", "filesPlacementDescription"]) {
      assert.match(source, new RegExp(`"settings\\.${key}": "`));
    }
  }
});

test("keeps General free of divider rows", () => {
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
  assert.match(agentSessionPanelSource, robotGlyph);
  assert.match(panelSource, /section === "agents"[\s\S]*?className="settings-section-icon is-agent"/);
  assert.match(cssSource, /\.settings-section-icon\.is-agent \{[\s\S]*?transform: scale\(1\.25\)/);
});

test("uses the compact controls glyph for General", () => {
  assert.match(panelSource, /section === "general"[\s\S]*?<path d="M20 7h-9M14 17H5" \/>[\s\S]*?<circle cx="7" cy="7" r="3" \/>[\s\S]*?<circle cx="17" cy="17" r="3" \/>/);
});

test("keeps password authentication to one login field and one settings action", () => {
  assert.equal((loginSource.match(/type="password"/g) ?? []).length, 1);
  assert.doesNotMatch(loginSource, /type="(?:text|email)"/);
  assert.match(loginSource, /autoComplete="current-password"/);
  assert.match(loginSource, /safeLoginDestination\(destination, window\.location\.origin\)/);
  assert.match(panelSource, /fetch\("\/api\/web-auth", \{ method: "DELETE" \}\)/);
  assert.match(panelSource, /t\("auth\.logOut"\)/);
  assert.match(loginSource, /className="web-login-composer"[\s\S]*?type="password"[\s\S]*?<button type="submit"/);
  assert.match(globalCssSource, /\.web-login-composer \{[\s\S]*?display: flex;[\s\S]*?border-radius: 14px/);
});
