import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("SkillsConfig is Settings-only master-detail and keeps API contracts", () => {
  assert.match(source, /onControllerChange\?\(controller: SettingsSectionController\)/);
  assert.match(source, /onControllerChange\?\.\(controller\)/);
  assert.doesNotMatch(source, /embedded = false/);
  assert.match(source, /<SkillsNavigator/);
  assert.match(source, /resource-settings-layout/);
  assert.match(source, /fetch\(`\/api\/skills\?cwd=\$\{encodeURIComponent\(cwd\)\}`\)/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /JSON\.stringify\(\{\s*filePath: skill\.filePath,\s*disableModelInvocation: next,/);
  assert.match(source, /fetch\("\/api\/skills\/search"/);
  assert.match(source, /fetch\("\/api\/skills\/install"/);
  assert.match(source, /fetch\("\/api\/skills\/check"/);
  assert.match(source, /fetch\("\/api\/skills\/update"/);
});

test("SkillsConfig repairs selection by filePath and returns to list when gone", () => {
  assert.match(source, /resolveSkillsSelection\(current, list\)/);
  assert.match(source, /if \(current\) \{\s*setMobileView\("list"\)/);
  assert.match(source, /if \(addMode\) \{ setAddMode\(false\); return true; \}/);
  assert.match(source, /if \(isMobile && mobileView === "detail"\) \{ setMobileView\("list"\); return true; \}/);
});

test("SkillsConfig search never uses a filtered array index as identity", () => {
  assert.match(source, /onSelect=\{\(filePath\) => openDetail\(filePath\)\}/);
  assert.doesNotMatch(source, /skills\[index\]\.filePath/);
});
