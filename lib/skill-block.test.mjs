import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { splitSkillBlocks } = await jiti.import("./skill-block.ts");

test("passes through text without skill blocks", () => {
  assert.deepEqual(splitSkillBlocks("hello world"), [{ type: "text", text: "hello world" }]);
});

test("extracts a single skill block with name and location", () => {
  const text = '<skill name="git" location="/home/me/.pi/skills/git/SKILL.md">\nReferences are relative to /home/me/.pi/skills/git.\n\nDo the thing.\n</skill>';
  const segments = splitSkillBlocks(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "skill");
  const skill = segments[0];
  if (skill.type !== "skill") throw new Error("unreachable");
  assert.equal(skill.name, "git");
  assert.equal(skill.location, "/home/me/.pi/skills/git/SKILL.md");
  assert.match(skill.content, /Do the thing\./);
});

test("keeps surrounding text segments in order", () => {
  const text = 'intro\n\n<skill name="git" location="/x/SKILL.md">\nBody.\n</skill>\n\noutro';
  const segments = splitSkillBlocks(text);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, "text");
  assert.match(segments[0].text, /intro/);
  assert.equal(segments[1].type, "skill");
  assert.equal(segments[2].type, "text");
  assert.match(segments[2].text, /outro/);
});

test("extracts multiple skill blocks", () => {
  const text = '<skill name="a" location="/a/SKILL.md">\nA.\n</skill>\n<skill name="b" location="/b/SKILL.md">\nB.\n</skill>';
  const segments = splitSkillBlocks(text);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, "skill");
  assert.equal(segments[1].type, "text");
  assert.equal(segments[2].type, "skill");
  const names = segments.map((s) => (s.type === "skill" ? s.name : null));
  assert.deepEqual(names, ["a", null, "b"]);
});

test("handles attributes in any order", () => {
  const text = '<skill location="/x/SKILL.md" name="pdf">\nBody.\n</skill>';
  const segments = splitSkillBlocks(text);
  assert.equal(segments[0].type, "skill");
  if (segments[0].type !== "skill") throw new Error("unreachable");
  assert.equal(segments[0].name, "pdf");
  assert.equal(segments[0].location, "/x/SKILL.md");
});

test("treats an unterminated <skill tag as plain text", () => {
  const text = "see <skill name=\"x\"";
  const segments = splitSkillBlocks(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, text);
});

test("returns an empty text segment for empty input", () => {
  const segments = splitSkillBlocks("");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, "");
});
