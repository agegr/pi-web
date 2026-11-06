import assert from "node:assert/strict";
import test from "node:test";

const { skillNameFromPath, skillNamesInText, skillsFromToolCall, skillsFromToolBlock, skillNamesInSkillBlocks } = await import("./turn-skills.ts");
const { parseStreamingJson } = await import("@earendil-works/pi-ai/utils/json-parse");

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

test("names a skill from a tool call still streaming its arguments", () => {
  // The path has arrived; the JSON is not closed yet.
  assert.deepEqual(skillsFromToolBlock({ input: {}, rawInput: '{"path":"/root/.pi/agent/skills/review/SKILL.md"' }, parseStreamingJson), ["review"]);
  // Not until the whole file name is there.
  assert.deepEqual(skillsFromToolBlock({ input: {}, rawInput: '{"path":"/root/.pi/agent/skills/review/SKI' }, parseStreamingJson), []);
  // A closed call is read from its arguments alone.
  assert.deepEqual(skillsFromToolBlock({ input: { path: "/root/.pi/agent/skills/deploy/SKILL.md" } }, parseStreamingJson), ["deploy"]);
});

test("names the skill pi writes into the transcript as a block", () => {
  // The exact shape `_expandSkillCommand` produces for /skill:<name>.
  const injected = [
    '<skill name="thinking-in-chinese" location="/root/.pi/agent/skills/thinking-in-chinese/SKILL.md">',
    "References are relative to /root/.pi/agent/skills/thinking-in-chinese.",
    "",
    "# 用中文思考 (thinking-in-chinese)",
    "</skill>",
  ].join("\n");
  assert.deepEqual(skillNamesInSkillBlocks(injected), ["thinking-in-chinese"]);
});

test("reads every skill block a message carries, once each", () => {
  const two = '<skill name="a" location="/x/skills/a/SKILL.md">\nA\n</skill>\n\n<skill name="b" location="/x/skills/b/SKILL.md">\nB\n</skill>';
  assert.deepEqual(skillNamesInSkillBlocks(two), ["a", "b"]);
  assert.deepEqual(skillNamesInSkillBlocks('<skill name="a" location="/x">a</skill><skill name="a" location="/x">a</skill>'), ["a"]);
});

test("ignores text that only mentions a skill", () => {
  assert.deepEqual(skillNamesInSkillBlocks("the <skill> tag loads a skill"), []);
  assert.deepEqual(skillNamesInSkillBlocks("plain user message"), []);
  assert.deepEqual(skillNamesInSkillBlocks(""), []);
});
