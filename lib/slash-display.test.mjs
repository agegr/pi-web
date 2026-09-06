import assert from "node:assert/strict";
import test from "node:test";

const { skillExpansionToCommand } = await import("./slash-display.ts");

function skillExpansion({
  name = "review",
  location = "/path/to/review/SKILL.md",
  baseDir = "/path/to/review",
  body = "Review the supplied files.",
  args,
} = {}) {
  return `<skill name="${name}" location="${location}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>${args === undefined ? "" : `\n\n${args}`}`;
}

test("restores a complete SDK skill expansion with arguments", () => {
  assert.equal(
    skillExpansionToCommand(skillExpansion({ args: "src/main.ts" })),
    "/skill:review src/main.ts",
  );
});

test("restores a complete SDK skill expansion without arguments", () => {
  assert.equal(skillExpansionToCommand(skillExpansion()), "/skill:review");
});

test("restores multiline arguments", () => {
  assert.equal(
    skillExpansionToCommand(skillExpansion({ args: "first line\nsecond line" })),
    "/skill:review first line\nsecond line",
  );
});

test("uses the final closing tag when the skill body contains an example", () => {
  assert.equal(
    skillExpansionToCommand(skillExpansion({ body: "Example:\n</skill>\nContinue.", args: "src" })),
    "/skill:review src",
  );
});

test("does not collapse incomplete or lookalike user text", () => {
  assert.equal(
    skillExpansionToCommand('<skill name="review" location="/path/to/review/SKILL.md">\nordinary user text'),
    null,
  );
  assert.equal(
    skillExpansionToCommand('<skill name="review" location="/path/to/review/SKILL.md">\nReferences are elsewhere.\n\nbody\n</skill>'),
    null,
  );
  assert.equal(skillExpansionToCommand("ordinary user text"), null);
});

test("collapse keeps session auto-naming free of skill XML", () => {
  const firstMessage = skillExpansion({ name: "agent-md", args: "写计划" });
  const collapsed = skillExpansionToCommand(firstMessage) ?? firstMessage;
  assert.equal(collapsed, "/skill:agent-md 写计划");
  // The sidebar slices the display form to 50 chars for the fallback title.
  assert.ok(collapsed.length <= 50);
  assert.ok(!collapsed.includes("<skill"));
});

test("plain first messages pass through unchanged for naming", () => {
  assert.equal(skillExpansionToCommand("hello world") ?? "hello world", "hello world");
  assert.equal(skillExpansionToCommand("") ?? "", "");
});
