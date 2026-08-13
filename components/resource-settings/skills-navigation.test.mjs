import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  filterSkillsNavigation,
  resolveSkillsSelection,
  skillIdentity,
  skillsSelectionLabel,
} = await jiti.import("./skills-navigation.ts");

const skills = [
  { name: "review", description: "Review PRs", filePath: "/a/review/SKILL.md", disableModelInvocation: false },
  { name: "deploy", description: "Ship it", filePath: "/a/deploy/SKILL.md", disableModelInvocation: true },
  { name: "notes", description: "Take notes", filePath: "/hidden/notes/SKILL.md", disableModelInvocation: true },
];

test("identity is filePath, never a filtered index", () => {
  assert.equal(skillIdentity(skills[1]), "/a/deploy/SKILL.md");
});

test("empty query keeps active/dormant groups and explicit dormant disclosure", () => {
  const closed = filterSkillsNavigation(skills, "", false);
  assert.deepEqual(closed.active.map((s) => s.filePath), ["/a/review/SKILL.md"]);
  assert.deepEqual(closed.dormant.map((s) => s.filePath), ["/a/deploy/SKILL.md", "/hidden/notes/SKILL.md"]);
  assert.equal(closed.dormantOpen, false);

  const open = filterSkillsNavigation(skills, "", true);
  assert.equal(open.dormantOpen, true);
});

test("search is case-insensitive on name, description, and filePath", () => {
  assert.deepEqual(filterSkillsNavigation(skills, "REVIEW", false).active.map((s) => s.filePath), ["/a/review/SKILL.md"]);
  assert.deepEqual(filterSkillsNavigation(skills, "ship", false).dormant.map((s) => s.filePath), ["/a/deploy/SKILL.md"]);
  assert.deepEqual(filterSkillsNavigation(skills, "/hidden/", false).dormant.map((s) => s.filePath), ["/hidden/notes/SKILL.md"]);
});

test("a dormant match keeps its parent group visible even when disclosure was closed", () => {
  const result = filterSkillsNavigation(skills, "deploy", false);
  assert.equal(result.active.length, 0);
  assert.deepEqual(result.dormant.map((s) => s.filePath), ["/a/deploy/SKILL.md"]);
  assert.equal(result.dormantOpen, true);
});

test("selection falls back to list when the filePath is gone", () => {
  assert.equal(resolveSkillsSelection("/a/review/SKILL.md", skills), "/a/review/SKILL.md");
  assert.equal(resolveSkillsSelection("/gone/SKILL.md", skills), null);
  assert.equal(resolveSkillsSelection(null, skills), null);
});

test("selection labels use the skill name and path", () => {
  assert.deepEqual(skillsSelectionLabel("/a/review/SKILL.md", skills), {
    title: "review",
    subtitle: "/a/review/SKILL.md",
  });
  assert.deepEqual(skillsSelectionLabel("/gone", skills), { title: "" });
});
