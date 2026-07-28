import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = relativePath => readFile(path.join(root, relativePath), "utf8");

function sourceBetween(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Start boundary not found: ${startMarker}`);
  assert.notEqual(end, -1, `End boundary not found: ${endMarker}`);
  return content.slice(start, end);
}

function assertNativeSelectionButton(content, selectionPattern) {
  assert.match(content, /<button\s+[\s\S]*?type="button"/);
  assert.match(content, /aria-pressed=\{is[A-Za-z]*Selected\}/);
  assert.match(content, selectionPattern);
  assert.doesNotMatch(content, /<div\s+[\s\S]*?onClick=/);
  assert.equal(content.match(/<button\b/g)?.length, 1, "selection items must not nest buttons");
}

test("the three configuration components render settings content without top-level modal shells", async () => {
  const [models, skills, plugins] = await Promise.all([
    source("components/ModelsConfig.tsx"),
    source("components/SkillsConfig.tsx"),
    source("components/PluginsConfig.tsx"),
  ]);

  assert.match(models, /export function ModelsConfig\(\{ onSaved \}/);
  assert.match(models, /onSaved\?: \(\) => void/);
  assert.match(skills, /export function SkillsConfig\(\{ cwd \}/);
  assert.match(plugins, /export function PluginsConfig\(\{ cwd, sessionId, onReloaded \}/);
  assert.doesNotMatch(skills, /position: "fixed"/);
  assert.doesNotMatch(plugins, /position: "fixed"/);
  assert.match(models, /AddProviderPicker/);
});

test("model save and plugin reload send exact callbacks to the application layer", async () => {
  const [models, plugins] = await Promise.all([
    source("components/ModelsConfig.tsx"),
    source("components/PluginsConfig.tsx"),
  ]);

  assert.match(
    models,
    /else \{\s*setSavedOk\(true\);[\s\S]*?onSaved\?\.\(\);\s*\}/,
  );
  assert.match(plugins, /onReloaded\?\.\(\)/);
  assert.match(models, /AddProviderPicker/);
});

test("model save errors use an alert live region", async () => {
  const models = await source("components/ModelsConfig.tsx");

  assert.match(models, /saveError && <span role="alert"/);
});

test("AddProviderPicker has an accessible name and traps keyboard focus", async () => {
  const models = await source("components/ModelsConfig.tsx");

  assert.match(models, /aria-labelledby="add-provider-picker-title"/);
  assert.match(models, /id="add-provider-picker-title"/);
  assert.match(models, /if \(event\.key === "Escape"\)[\s\S]*?event\.stopPropagation\(\);[\s\S]*?onClose\(\);/);
  assert.match(models, /if \(event\.key !== "Tab"\) return;/);
  assert.match(models, /querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/);
  assert.match(models, /event\.shiftKey && document\.activeElement === firstFocusable/);
  assert.match(models, /lastFocusable\.focus\(\)/);
  assert.match(models, /!event\.shiftKey && document\.activeElement === lastFocusable/);
  assert.match(models, /firstFocusable\.focus\(\)/);
  assert.match(models, /inputRef\.current\?\.focus\(\)/);
  assert.match(models, /previouslyFocused\?\.isConnected[\s\S]*?previouslyFocused\.focus\(\)/);
});

test("SettingsModal provides five top-level menus and disables project-dependent content", async () => {
  const content = await source("components/SettingsModal.tsx");

  for (const section of ["general", "models", "skills", "plugins", "security"]) {
    assert.match(content, new RegExp(`id: "${section}"`));
  }
  assert.match(content, /const \[activeSection, setActiveSection\] = useState<SettingsSection>\("general"\)/);
  assert.match(content, /disabled: !cwd/);
  assert.match(content, /settings\.projectRequired/);
  assert.match(content, /visitedSections/);
  assert.match(content, /hidden=\{activeSection !== section\.id\}/);
});

test("SettingsModal is a top-level dialog supporting Escape, focus trapping, and restoration", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /role="dialog"/);
  assert.match(content, /aria-modal="true"/);
  assert.match(content, /event\.key === "Escape"/);
  assert.match(content, /event\.key !== "Tab"/);
  assert.match(content, /previouslyFocused\.focus\(\)/);
  assert.match(content, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(content, /event\.defaultPrevented/);
});

test("the parent SettingsModal prevents consumed Escape events from reaching the window abort listener", async () => {
  const [modal, shortcuts] = await Promise.all([
    source("components/SettingsModal.tsx"),
    source("hooks/useKeyboardShortcuts.ts"),
  ]);
  const escapeBranch = sourceBetween(
    modal,
    'if (event.key === "Escape") {',
    'if (event.key !== "Tab") return;',
  );

  assert.match(
    escapeBranch,
    /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*onClose\(\);\s*return;/,
  );
  assert.match(shortcuts, /window\.addEventListener\("keydown", handler\)/);
  assert.match(shortcuts, /if \(e\.key === "Escape"\)[\s\S]*?globalAbortHandler\(\)/);
});

test("key model selection branches use native buttons without nested interactive controls", async () => {
  const models = await source("components/ModelsConfig.tsx");
  const cases = [
    ["{/* Active OAuth subscriptions */}", "{/* Active API key providers */}", /setSelection\(\{ type: "oauth", providerId: p\.id \}\)/],
    ["{/* Active API key providers */}", "{/* Divider before custom providers", /setSelection\(\{ type: "apikey", providerId: p\.id \}\)/],
    ["{/* Provider row */}", "{/* Model rows */}", /setSelection\(\{ type: "provider", name: pName \}\)/],
    ["{/* Model rows */}", "{/* Add model button */}", /setSelection\(\{ type: "model", providerName: pName, index: i \}\)/],
  ];

  for (const [start, end, selectionPattern] of cases) {
    assertNativeSelectionButton(sourceBetween(models, start, end), selectionPattern);
  }
});

test("key skills and plugin selection branches use native buttons without nested buttons", async () => {
  const [skills, plugins] = await Promise.all([
    source("components/SkillsConfig.tsx"),
    source("components/PluginsConfig.tsx"),
  ]);
  const skillItem = sourceBetween(skills, "{grpSkills.map((skill) => {", "{/* Add skill button */}");
  const packageItem = sourceBetween(plugins, "{group.packages.map((pkg) => {", "<div style={{ padding: \"8px 6px\", borderTop:");

  assertNativeSelectionButton(skillItem, /setSelected\(skill\.filePath\);\s*setAddMode\(false\);/);
  assertNativeSelectionButton(packageItem, /setSelected\(key\);\s*setAddMode\(false\);/);
});

test("the parent dialog precisely traps visible focus and restores only connected original focus", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /previouslyFocused\?\.isConnected[\s\S]*?previouslyFocused\.focus\(\)/);
  assert.match(content, /!element\.closest\('\[hidden\], \[aria-hidden="true"\]'\)/);
  assert.match(content, /element\.getClientRects\(\)\.length > 0/);
  assert.match(
    content,
    /event\.shiftKey && document\.activeElement === first\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?last\.focus\(\);/,
  );
  assert.match(
    content,
    /!event\.shiftKey && document\.activeElement === last\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?first\.focus\(\);/,
  );
});

test("the general page uses shared SegmentedControl and OptionSelect controls", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /import \{ SegmentedControl \} from "\.\/ui\/SegmentedControl";/);
  assert.match(content, /import \{ OptionSelect \} from "\.\/ui\/OptionSelect";/);
  assert.match(content, /import \{ useTheme, type ThemePreference \} from "@\/hooks\/useTheme";/);
  // Preserve the three-state theme options and View Transition coordinates.
  assert.match(content, /<SegmentedControl/);
  assert.match(content, /value=\{preference\}/);
  assert.match(content, /\{ value: "system", label: translate\("settings\.system"\) \}/);
  assert.match(content, /\{ value: "light", label: translate\("settings\.light"\) \}/);
  assert.match(content, /\{ value: "dark", label: translate\("settings\.dark"\) \}/);
  assert.match(content, /event\.currentTarget\.getBoundingClientRect\(\)/);
  assert.match(content, /setThemePreference\(value as ThemePreference,/);
  // The language is a dynamic OptionSelect whose options come entirely from supportedLocales.
  assert.match(content, /<OptionSelect/);
  assert.match(content, /value=\{locale\}/);
  assert.match(content, /options=\{supportedLocales\.map\(plugin => \(\{ value: plugin\.id, label: plugin\.label \}\)\)\}/);
  assert.match(content, /onChange=\{value => setLocale\(value\)\}/);
  // Native select and legacy compact button styles are no longer present.
  assert.doesNotMatch(content, /<select/);
  assert.doesNotMatch(content, /settings-compact-choice/);
  assert.doesNotMatch(content, /settings-language-select/);
  assert.match(content, /PasswordChangeForm/);
});

test("SettingsModal provides structural classes without locking in Task 4 responsive visuals", async () => {
  const content = await source("components/SettingsModal.tsx");

  for (const className of [
    "settings-modal",
    "settings-dialog",
    "settings-header",
    "settings-layout",
    "settings-navigation",
    "settings-navigation-list",
    "settings-tab",
    "settings-content",
    "settings-content-panel",
  ]) {
    assert.match(content, new RegExp(`className=.*${className}`));
  }
  assert.doesNotMatch(content, /\sstyle=\{/);
  assert.doesNotMatch(content, /gridTemplateColumns|flexDirection|desktopNavStyle|mobileNavStyle|tabStyle/);
  assert.doesNotMatch(content, /React\.CSSProperties/);
  assert.doesNotMatch(content, /settings-nav(?:-mobile|-desktop|\s)/);
});

test("top-level navigation uses responsive tab keyboard semantics and skips disabled items", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /role="tablist"/);
  assert.match(content, /role="tab"/);
  assert.match(content, /aria-orientation=\{isMobile \? "horizontal" : "vertical"\}/);
  assert.match(content, /isMobile \? \["ArrowLeft", "ArrowRight"\] : \["ArrowUp", "ArrowDown"\]/);
  assert.match(content, /sections\.filter\(section => !section\.disabled\)/);
  assert.match(content, /aria-disabled=\{section\.disabled \? "true" : undefined\}/);
  assert.match(content, /title=\{section\.disabled \? projectRequired : undefined\}/);
});

test("tabs and lazily mounted panels use complete associations and roving tabindex", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /id=\{`settings-tab-\$\{section\.id\}`\}[\s\S]*?aria-controls=\{`settings-panel-\$\{section\.id\}`\}/);
  assert.match(content, /tabIndex=\{activeSection === section\.id \? 0 : -1\}/);
  assert.match(content, /sections\.map\(section => visitedSections\.has\(section\.id\) && \(/);
  assert.match(content, /id=\{`settings-panel-\$\{section\.id\}`\}[\s\S]*?aria-labelledby=\{`settings-tab-\$\{section\.id\}`\}[\s\S]*?hidden=\{activeSection !== section\.id\}/);
  assert.match(content, /if \(event\.target === event\.currentTarget\) onClose\(\);/);
});

test("when cwd becomes invalid, the project settings fall back to general and focus its tab", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /generalTabRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(content, /const activeSectionDisabled = sections\.some\([\s\S]*?section\.id === activeSection && section\.disabled/);
  assert.match(content, /if \(!activeSectionDisabled\) return;[\s\S]*?setActiveSection\("general"\);[\s\S]*?generalTabRef\.current\?\.focus\(\);/);
  assert.match(content, /ref=\{section\.id === "general" \? generalTabRef : undefined\}/);
});

test("AppShell keeps one settings state and two sidebar icon entry points", async () => {
  const content = await source("components/AppShell.tsx");

  assert.match(content, /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/);
  assert.doesNotMatch(content, /modelsConfigOpen/);
  assert.doesNotMatch(content, /skillsConfigOpen/);
  assert.doesNotMatch(content, /pluginsConfigOpen/);
  assert.doesNotMatch(content, /authSettingsOpen/);
  assert.match(content, /<SettingsModal/);
  assert.match(content, /setSettingsOpen\(true\)/);
  assert.match(content, /handleLogout\(\)/);
  assert.match(content, /settings-sidebar-actions/);
});

test("AppShell removes the top theme and language shortcuts", async () => {
  const content = await source("components/AppShell.tsx");

  assert.doesNotMatch(content, /toggleTheme/);
  assert.doesNotMatch(content, /supportedLocales/);
  assert.doesNotMatch(content, /languageBtnRef/);
  assert.doesNotMatch(content, /activeTopPanel === "language"/);
});

test("settings center styling includes desktop columns, mobile tabs, and clear focus", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.settings-dialog/);
  assert.match(css, /\.settings-navigation/);
  assert.match(css, /\.settings-sidebar-icon:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*?\.settings-navigation-list \{[^}]*padding: 4px;[^}]*overflow-x: auto;/,
  );
  assert.doesNotMatch(css, /\.settings-nav(?=[\s,{.:])/);
});

test("the general and security settings pages use shared control styles", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.ui-segmented-control \{/);
  assert.match(css, /\.ui-option-select \{/);
  assert.match(css, /\.settings-security \.auth-form \{/);
  assert.doesNotMatch(css, /\.settings-compact-choice/);
  assert.doesNotMatch(css, /\.settings-language-select/);
  assert.doesNotMatch(css, /\.settings-fieldset label/);
});

test("both language packs provide the follow-system theme label", async () => {
  const [en, zhCN] = await Promise.all([
    source("lib/i18n/messages/en.ts"),
    source("lib/i18n/messages/zh-CN.ts"),
  ]);

  assert.match(en, /"settings\.system": "System"/);
  assert.match(zhCN, /"settings\.system": "\u8ddf\u968f\u7cfb\u7edf"/);
});

test("the project-required notice is outside the independently scrolling tablist and appears only without cwd", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(
    content,
    /<nav\s+className="settings-navigation">[\s\S]*?<div\s+className="settings-navigation-list"\s+role="tablist"[\s\S]*?<\/div>\s*\{!cwd && \(\s*<p className="settings-project-required">[\s\S]*?<\/p>\s*\)\}\s*<\/nav>/,
  );
  assert.match(content, /aria-orientation=\{isMobile \? "horizontal" : "vertical"\}/);
});

test("AppShell refreshes the model list only after a successful model save", async () => {
  const content = await source("components/AppShell.tsx");

  assert.equal(content.match(/setModelsRefreshKey\(/g)?.length, 1);
  assert.match(content, /onModelsSaved=\{\(\) => setModelsRefreshKey\(key => key \+ 1\)\}/);
  assert.match(content, /onSessionReloaded=\{\(\) => setSessionKey\(key => key \+ 1\)\}/);
});

test("model and skills button groups use the shared SegmentedControl", async () => {
  const [models, skills] = await Promise.all([
    source("components/ModelsConfig.tsx"),
    source("components/SkillsConfig.tsx"),
  ]);

  // The model page uses the shared control for Default/Disabled thinking levels; Disabled keeps danger semantics.
  assert.match(models, /import \{ SegmentedControl \} from "\.\/ui\/SegmentedControl";/);
  assert.match(models, /<SegmentedControl/);
  assert.match(models, /\{ value: "default", label: "Default" \}/);
  assert.match(models, /\{ value: "disabled", label: "Disabled", className: "ui-segmented-control-option--danger" \}/);
  assert.match(models, /onChange=\{\(next\) => setLevel\(level, next === "default" \? "omit" : null\)\}/);
  assert.doesNotMatch(models, /btnActiveDisabled/);
  // Keep the combined Custom + input control unchanged.
  assert.match(models, /placeholder=\{level\}/);

  // The skills page uses the shared control for Add Skill global/project scope, preserving disabled and title behavior.
  assert.match(skills, /import \{ SegmentedControl \} from "\.\/ui\/SegmentedControl";/);
  assert.match(skills, /<SegmentedControl/);
  assert.match(skills, /value=\{scope\}/);
  assert.match(skills, /disabled: !projectResourcesLoaded/);
  assert.match(skills, /t\("trust\.projectScopeUnavailable"\)/);
  assert.match(skills, /onChange=\{\(next\) => setScope\(next as "global" \| "project"\)\}/);
});
