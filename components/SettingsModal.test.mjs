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
  assert.notEqual(start, -1, `未找到起始边界：${startMarker}`);
  assert.notEqual(end, -1, `未找到结束边界：${endMarker}`);
  return content.slice(start, end);
}

function assertNativeSelectionButton(content, selectionPattern) {
  assert.match(content, /<button\s+[\s\S]*?type="button"/);
  assert.match(content, /aria-pressed=\{is[A-Za-z]*Selected\}/);
  assert.match(content, selectionPattern);
  assert.doesNotMatch(content, /<div\s+[\s\S]*?onClick=/);
  assert.equal(content.match(/<button\b/g)?.length, 1, "选择项不可嵌套 button");
}

test("三个配置组件只渲染设置内容，不再拥有一级模态外壳", async () => {
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

test("模型保存和插件重载向应用层发送精确回调", async () => {
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

test("模型保存错误使用 alert live region", async () => {
  const models = await source("components/ModelsConfig.tsx");

  assert.match(models, /saveError && <span role="alert"/);
});

test("AddProviderPicker 具备可访问名称并约束键盘焦点", async () => {
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

test("SettingsModal 提供五个一级菜单并禁用无项目内容", async () => {
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

test("SettingsModal 是支持 Escape、焦点约束和恢复的最上层 dialog", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /role="dialog"/);
  assert.match(content, /aria-modal="true"/);
  assert.match(content, /event\.key === "Escape"/);
  assert.match(content, /event\.key !== "Tab"/);
  assert.match(content, /previouslyFocused\.focus\(\)/);
  assert.match(content, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(content, /event\.defaultPrevented/);
});

test("父 SettingsModal 消费 Escape 后阻止事件到达 window abort listener", async () => {
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

test("模型关键选择分支均使用无嵌套交互控件的原生 button", async () => {
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

test("技能与插件关键选择分支使用原生 button 且不嵌套 button", async () => {
  const [skills, plugins] = await Promise.all([
    source("components/SkillsConfig.tsx"),
    source("components/PluginsConfig.tsx"),
  ]);
  const skillItem = sourceBetween(skills, "{grpSkills.map((skill) => {", "{/* Add skill button */}");
  const packageItem = sourceBetween(plugins, "{group.packages.map((pkg) => {", "<div style={{ padding: \"8px 6px\", borderTop:");

  assertNativeSelectionButton(skillItem, /setSelected\(skill\.filePath\);\s*setAddMode\(false\);/);
  assertNativeSelectionButton(packageItem, /setSelected\(key\);\s*setAddMode\(false\);/);
});

test("父 dialog 精确约束可见焦点并仅恢复仍连接的原焦点", async () => {
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

test("通用页提供三态主题按钮和受控动态语言下拉", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /useTheme\(\)/);
  assert.match(content, /useI18n\(\)/);
  assert.match(content, /id: "system"/);
  assert.match(content, /id: "light"/);
  assert.match(content, /id: "dark"/);
  assert.match(content, /setThemePreference\(option\.id/);
  assert.match(content, /setLocale/);
  assert.match(content, /<select[^>]*value=\{locale\}[^>]*onChange=/);
  assert.match(content, /onChange=\{event => setLocale\(event\.target\.value\)\}/);
  assert.doesNotMatch(content, /event\.target\.value as Locale/);
  assert.match(content, /supportedLocales\.map\(plugin => \(<option/);
  assert.match(content, /className="settings-compact-choice"/);
  assert.match(content, /PasswordChangeForm/);
});

test("SettingsModal 仅提供结构 class 而不锁定 Task 4 响应式视觉", async () => {
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

test("一级导航使用响应式 tab 键盘语义并跳过禁用项", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /role="tablist"/);
  assert.match(content, /role="tab"/);
  assert.match(content, /aria-orientation=\{isMobile \? "horizontal" : "vertical"\}/);
  assert.match(content, /isMobile \? \["ArrowLeft", "ArrowRight"\] : \["ArrowUp", "ArrowDown"\]/);
  assert.match(content, /sections\.filter\(section => !section\.disabled\)/);
  assert.match(content, /aria-disabled=\{section\.disabled \? "true" : undefined\}/);
  assert.match(content, /title=\{section\.disabled \? projectRequired : undefined\}/);
});

test("tab 与延迟挂载 panel 使用完整关联和 roving tabindex", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /id=\{`settings-tab-\$\{section\.id\}`\}[\s\S]*?aria-controls=\{`settings-panel-\$\{section\.id\}`\}/);
  assert.match(content, /tabIndex=\{activeSection === section\.id \? 0 : -1\}/);
  assert.match(content, /sections\.map\(section => visitedSections\.has\(section\.id\) && \(/);
  assert.match(content, /id=\{`settings-panel-\$\{section\.id\}`\}[\s\S]*?aria-labelledby=\{`settings-tab-\$\{section\.id\}`\}[\s\S]*?hidden=\{activeSection !== section\.id\}/);
  assert.match(content, /if \(event\.target === event\.currentTarget\) onClose\(\);/);
});

test("cwd 失效时从项目设置回退 general 并聚焦其 tab", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(content, /generalTabRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(content, /const activeSectionDisabled = sections\.some\([\s\S]*?section\.id === activeSection && section\.disabled/);
  assert.match(content, /if \(!activeSectionDisabled\) return;[\s\S]*?setActiveSection\("general"\);[\s\S]*?generalTabRef\.current\?\.focus\(\);/);
  assert.match(content, /ref=\{section\.id === "general" \? generalTabRef : undefined\}/);
});

test("AppShell 只保留一个设置状态和两个侧栏图标入口", async () => {
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

test("AppShell 移除顶部主题和语言快捷入口", async () => {
  const content = await source("components/AppShell.tsx");

  assert.doesNotMatch(content, /toggleTheme/);
  assert.doesNotMatch(content, /supportedLocales/);
  assert.doesNotMatch(content, /languageBtnRef/);
  assert.doesNotMatch(content, /activeTopPanel === "language"/);
});

test("设置中心样式包含桌面双栏、移动 tabs 和清晰焦点", async () => {
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

test("设置通用页和安全页使用紧凑 scoped 样式", async () => {
  const css = await source("app/globals.css");

  for (const selector of [
    ".settings-compact-choice",
    ".settings-language-select",
    ".settings-security .auth-form",
  ]) {
    assert.match(css, new RegExp(selector.replaceAll(".", "\\.")));
  }
  assert.match(css, /\.settings-compact-choice \{[^}]*font-size: 12px;[^}]*border-radius: 5px;/);
  assert.match(css, /\.settings-language-select \{[^}]*font-size: 12px;[^}]*border-radius: 5px;/);
});

test("双语语言包提供跟随系统主题文案", async () => {
  const [en, zhCN] = await Promise.all([
    source("lib/i18n/messages/en.ts"),
    source("lib/i18n/messages/zh-CN.ts"),
  ]);

  assert.match(en, /"settings\.system": "System"/);
  assert.match(zhCN, /"settings\.system": "跟随系统"/);
});

test("项目必需说明位于独立滚动 tablist 外并仅在无 cwd 时显示", async () => {
  const content = await source("components/SettingsModal.tsx");

  assert.match(
    content,
    /<nav\s+className="settings-navigation">[\s\S]*?<div\s+className="settings-navigation-list"\s+role="tablist"[\s\S]*?<\/div>\s*\{!cwd && \(\s*<p className="settings-project-required">[\s\S]*?<\/p>\s*\)\}\s*<\/nav>/,
  );
  assert.match(content, /aria-orientation=\{isMobile \? "horizontal" : "vertical"\}/);
});

test("AppShell 仅在模型保存成功时触发模型列表刷新", async () => {
  const content = await source("components/AppShell.tsx");

  assert.equal(content.match(/setModelsRefreshKey\(/g)?.length, 1);
  assert.match(content, /onModelsSaved=\{\(\) => setModelsRefreshKey\(key => key \+ 1\)\}/);
  assert.match(content, /onSessionReloaded=\{\(\) => setSessionKey\(key => key \+ 1\)\}/);
});
