import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./SettingsPage.tsx", import.meta.url), "utf8");
const picker = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

test("AppShell exposes one unified settings entry", () => {
  assert.match(shell, /<SettingsPage/);
  assert.equal((shell.match(/setSettingsOpen\(true\)/g) ?? []).length, 1);
  assert.doesNotMatch(shell, /<ModelsConfig|<SkillsConfig|<PluginsConfig/);
});

test("settings embeds the existing model, skill, and plugin modules", () => {
  assert.match(settings, /<ModelsConfig embedded/);
  assert.match(settings, /<SkillsConfig embedded/);
  assert.match(settings, /<PluginsConfig\s+embedded/);
  assert.match(settings, /type SettingsSection = "general" \| "project" \| "archived" \| "models" \| "skills" \| "plugins"/);
});

test("settings lists archived projects and restores them through the project registry", () => {
  assert.match(settings, /fetch\("\/api\/projects", \{ cache: "no-store" \}\)/);
  assert.match(settings, /project\.archived && !project\.removed/);
  assert.match(settings, /method: "PATCH"/);
  assert.match(settings, /JSON\.stringify\(\{ path, update: \{ archived: false \} \}\)/);
  assert.match(settings, /disabled=\{restoringProjects\.has\(project\.path\)\}/);
  assert.match(settings, /loadProjects\(false\)/);
  assert.match(settings, /<ArchiveRestore size=\{14\}/);
  assert.match(settings, /onProjectsChanged\(\)/);
});

test("settings owns general preferences and project trust", () => {
  assert.match(settings, /useState<SettingsSection>\("general"\)/);
  assert.match(settings, /onThemeChange\(id\)/);
  assert.match(settings, /onLocaleChange\(event\.target\.value as Locale\)/);
  assert.match(settings, /role="switch" aria-checked=\{soundEnabled\}/);
  assert.match(settings, /onClick=\{onTrustProject\}/);
  assert.doesNotMatch(settings, /<svg/);
});

test("directory picker creates a folder through the browse API", () => {
  assert.match(picker, /fetch\("\/api\/cwd\/browse", \{/);
  assert.match(picker, /method: "POST"/);
  assert.match(picker, /JSON\.stringify\(\{ parentPath: currentPath, name \}\)/);
  assert.match(picker, /await navigateTo\(data\.path\)/);
});
