import assert from "node:assert/strict";
import test from "node:test";

const { skillNameFromPath, skillNamesInText, skillsFromToolCall } = await import("./turn-skills.ts");

test("names the skill a SKILL.md path loads", () => {
  assert.equal(skillNameFromPath("/root/.pi/agent/skills/review/SKILL.md"), "review");
  assert.equal(skillNameFromPath("skills/brainstorming/SKILL.md"), "brainstorming");
  assert.equal(skillNameFromPath("./.claude/skills/deploy/SKILL.md"), "deploy");
  assert.equal(skillNameFromPath("/home/me/.agents/skills/writing-plans/SKILL.md"), "writing-plans");
});

test("reads a path out of the punctuation a command line leaves on it", () => {
  assert.equal(skillNameFromPath("'/root/.pi/agent/skills/review/SKILL.md'"), "review");
  assert.equal(skillNameFromPath("C:\\\\Users\\\\me\\\\.claude\\\\skills\\\\deploy\\\\SKILL.md"), "deploy");
  assert.equal(skillNameFromPath("/root/.pi/agent/skills/review/SKILL.md#L1"), "review");
});

test("refuses a SKILL.md that is not inside a skills folder", () => {
  assert.equal(skillNameFromPath("/repo/docs/SKILL.md"), null);
  assert.equal(skillNameFromPath("/repo/docs/skills/SKILL.md"), null);
  assert.equal(skillNameFromPath("/repo/README.md"), null);
  assert.equal(skillNameFromPath(""), null);
});

test("finds a skill named inside a whole command", () => {
  assert.deepEqual(skillNamesInText("cat /root/.pi/agent/skills/using-proxy/SKILL.md | head -60"), ["using-proxy"]);
  assert.deepEqual(skillNamesInText("ls /root/.pi/agent/skills/review/"), []);
  assert.deepEqual(skillNamesInText("plain text"), []);
});

test("collects skills from any argument of a tool call, at any depth", () => {
  assert.deepEqual(skillsFromToolCall({ path: "/root/.pi/agent/skills/review/SKILL.md" }), ["review"]);
  assert.deepEqual(skillsFromToolCall({ command: "cat /root/.pi/agent/skills/a/SKILL.md && cat /root/.pi/agent/skills/b/SKILL.md" }), ["a", "b"]);
  assert.deepEqual(skillsFromToolCall({ options: { files: ["/root/.pi/agent/skills/nested/SKILL.md"] } }), ["nested"]);
  assert.deepEqual(skillsFromToolCall({ command: "git status" }), []);
});
