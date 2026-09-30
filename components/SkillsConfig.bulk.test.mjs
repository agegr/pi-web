import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { applySkillToggleResults, skillsToSwitch } = await jiti.import("./SkillsConfig.tsx");

const skills = [
  { name: "a", filePath: "/skills/a/SKILL.md", disableModelInvocation: false },
  { name: "b", filePath: "/skills/b/SKILL.md", disableModelInvocation: true },
  { name: "c", filePath: "/skills/c/SKILL.md", disableModelInvocation: true },
];

test("bulk buttons only target the skills that would change", () => {
  assert.deepEqual(skillsToSwitch(skills, true).map((skill) => skill.name), ["b", "c"]);
  assert.deepEqual(skillsToSwitch(skills, false).map((skill) => skill.name), ["a"]);
  const allVisible = skills.map((skill) => ({ ...skill, disableModelInvocation: false }));
  assert.deepEqual(skillsToSwitch(allVisible, true), []);
});

test("a bulk result switches the skills that succeeded and keeps the failures as they were", () => {
  const next = applySkillToggleResults(skills, [
    { filePath: "/skills/b/SKILL.md" },
    { filePath: "/skills/c/SKILL.md", error: "Access denied" },
  ], false);

  assert.deepEqual(next.map((skill) => [skill.name, skill.disableModelInvocation]), [
    ["a", false],
    ["b", false],
    ["c", true],
  ]);
  assert.equal(next[0], skills[0], "untouched skills keep their identity");
});

test("the panel sends one batch request and blocks the buttons while switches are busy", () => {
  assert.match(source, /body: JSON\.stringify\(\{ filePaths, disableModelInvocation \}\)/);
  assert.match(source, /const bulkBusy = loading \|\| toggling\.size > 0 \|\| updatingSkill !== null;/);
  assert.match(source, /disabled=\{bulkBusy \|\| skillsToSwitch\(skills, true\)\.length === 0\}/);
  assert.match(source, /disabled=\{bulkBusy \|\| skillsToSwitch\(skills, false\)\.length === 0\}/);
  // Every targeted switch shows the loading state while the batch runs.
  assert.match(source, /setToggling\(\(current\) => new Set\(\[\.\.\.current, \.\.\.filePaths\]\)\)/);
});
