import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SkillsNavigator.tsx", import.meta.url), "utf8");

test("skills navigator uses labelled search, clear control, and native button rows", () => {
  assert.match(source, /aria-label=\{t\("resources\.searchSkills"\)\}/);
  assert.match(source, /\{query && \(/);
  assert.match(source, /aria-label=\{t\("i18n\.clearSearch"\)\}/);
  assert.match(source, /<button[\s\S]*?resource-settings-row/);
  assert.doesNotMatch(source, /onMouseEnter/);
});

test("skills navigator labels Active and Dormant groups and selected state", () => {
  assert.match(source, /role="group"/);
  assert.match(source, /aria-label=\{t\("resources\.active"\)\}/);
  assert.match(source, /aria-label=\{t\("resources\.dormant"\)\}/);
  assert.match(source, /data-selected=\{/);
  assert.match(source, /aria-expanded=\{dormantOpen\}/);
});

test("skills navigator stays controlled", () => {
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /useState/);
});
