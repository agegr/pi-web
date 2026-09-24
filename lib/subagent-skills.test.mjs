import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createSubagentSkillPreloadExtension,
  formatSubagentSkillBlocks,
  selectSubagentSkills,
  subagentSkillPromptText,
  subagentSkillsOverride,
} = await jiti.import("./subagent-skills.ts");
const { composeSubagentExactPrompt } = await jiti.import("./subagent-prompt.ts");

function fakeSkill(name, root, extra = {}) {
  const filePath = join(root, name, "SKILL.md");
  return {
    name,
    description: `${name} instructions`,
    filePath,
    baseDir: dirname(filePath),
    disableModelInvocation: false,
    ...extra,
  };
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function skillDir(cwd, name, body) {
  const dir = join(cwd, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  await writeFile(file, `---\nname: ${name}\ndescription: ${name} instructions\n---\n\n${body}\n`);
  return { name, description: `${name} instructions`, filePath: file, baseDir: dir, disableModelInvocation: false };
}

test("a scope keeps only the named skills, in the order they were requested", () => {
  const skills = [fakeSkill("alpha", "/tmp"), fakeSkill("beta", "/tmp"), fakeSkill("gamma", "/tmp")];

  assert.deepEqual(
    selectSubagentSkills(skills, ["gamma", "alpha"]).map((skill) => skill.name),
    ["gamma", "alpha"],
  );
});

test("an undefined scope keeps every discovered skill and an empty scope keeps none", () => {
  const skills = [fakeSkill("alpha", "/tmp"), fakeSkill("beta", "/tmp")];

  assert.deepEqual(selectSubagentSkills(skills, undefined).map((skill) => skill.name), ["alpha", "beta"]);
  assert.deepEqual(selectSubagentSkills(skills, []), []);
});

test("a named skill that is not installed is skipped", () => {
  assert.deepEqual(selectSubagentSkills([fakeSkill("alpha", "/tmp")], ["missing"]), []);
});

test("automatic discovery hides non-invocable skills but an explicit preload may name them", () => {
  const hidden = fakeSkill("hidden", "/tmp", { disableModelInvocation: true });
  const shown = fakeSkill("shown", "/tmp");

  assert.deepEqual(selectSubagentSkills([hidden, shown], undefined).map((s) => s.name), ["shown"]);
  assert.deepEqual(selectSubagentSkills([hidden, shown], ["hidden"]).map((s) => s.name), ["hidden"]);
});
test("the loader override narrows discovered skills and keeps diagnostics", () => {
  const diagnostics = [{ type: "warning", message: "probe" }];
  const base = {
    skills: [fakeSkill("alpha", "/tmp"), fakeSkill("beta", "/tmp")],
    diagnostics,
  };
  const result = subagentSkillsOverride(["alpha"])(base);

  assert.deepEqual(result.skills.map((skill) => skill.name), ["alpha"]);
  assert.equal(result.diagnostics, diagnostics, "diagnostics must be passed through, not rebuilt");
  assert.deepEqual(base.skills.map((skill) => skill.name), ["alpha", "beta"], "the base list is not mutated");
});

test("an explicit scope inlines the skill bodies", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const review = await skillDir(cwd, "code-review", "Review the diff.");
    const testing = await skillDir(cwd, "testing", "Write the test first.");
    const skills = [review, testing, fakeSkill("untouched", "/tmp")];

    const text = subagentSkillPromptText({ skills, scope: ["code-review", "testing"], tools: ["read"] });

    assert.match(text, /Review the diff\./);
    assert.match(text, /Write the test first\./);
    assert.doesNotMatch(text, /untouched/);
    assert.equal((text.match(/^<skill /gm) ?? []).length, 2);
    // Inlined bodies need no tool, so a tool-free profile still gets them.
    assert.equal(
      subagentSkillPromptText({ skills, scope: ["code-review"], tools: [] }),
      formatSubagentSkillBlocks([review])[0],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("no scope lists skills for on-demand loading instead of inlining all of them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const review = await skillDir(cwd, "code-review", "Review the diff body.");
    const skills = [review];

    const text = subagentSkillPromptText({ skills, tools: ["read"] });

    // Pi's own listing shape, wrapped like Pi wraps its `<skills>` section.
    assert.match(text, /^<skills>\n/);
    assert.match(text, /<available_skills>/);
    assert.match(text, /<name>code-review<\/name>/);
    assert.match(text, /<location>/);
    // No body: every installed skill is unbounded.
    assert.doesNotMatch(text, /Review the diff body\./);
    assert.equal(subagentSkillPromptText({ skills, scope: [], tools: ["read"] }), "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a hidden skill is absent from discovery but can be explicitly preloaded", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const review = await skillDir(cwd, "code-review", "Review the diff.");
    const hidden = { ...await skillDir(cwd, "legacy", "Legacy body."), disableModelInvocation: true };
    const skills = [review, hidden];

    assert.match(
      subagentSkillPromptText({ skills, scope: ["legacy"], tools: [] }),
      /Legacy body./,
    );
    assert.doesNotMatch(subagentSkillPromptText({ skills, tools: ["read"] }), /legacy/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
test("the append-mode preload extension appends named skill text to the current prompt", () => {
  let handler;
  const extension = createSubagentSkillPreloadExtension(() => "<skill name=\"review\">Review.</skill>");
  extension.factory({
    on: (event, callback) => {
      assert.equal(event, "before_agent_start");
      handler = callback;
    },
  });

  assert.deepEqual(handler({ systemPrompt: "Base prompt" }), {
    systemPrompt: "Base prompt\n\n<skill name=\"review\">Review.</skill>",
  });
});

test("a listing names only a tool the profile actually has", () => {
  const skills = [fakeSkill("alpha", "/tmp")];

  assert.match(subagentSkillPromptText({ skills, tools: ["read", "bash"] }), /read tool/);
  assert.match(subagentSkillPromptText({ skills, tools: ["bash"] }), /Use bash/);
  // Pi's gate: with no tool that can open a skill file there is no listing at all,
  // rather than one pointing at a tool the subagent cannot call. `powershell` is
  // what `bash` resolves to on Windows, so it must not be mistaken for a shell.
  assert.equal(subagentSkillPromptText({ skills, tools: ["grep", "find", "ls"] }), "");
  assert.equal(subagentSkillPromptText({ skills, tools: ["powershell"] }), "");
});

test("a skill file that cannot be read is dropped, not fatal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const gone = await skillDir(cwd, "gone", "will be removed");
    const kept = await skillDir(cwd, "kept", "Keep me.");
    await rm(gone.filePath, { force: true });

    const blocks = formatSubagentSkillBlocks([gone, kept]);

    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /Keep me\./);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a skill formats as a self-contained prompt block", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const { filePath, baseDir } = await skillDir(cwd, "code-review", "Review the diff.");

    const [block] = formatSubagentSkillBlocks([
      { name: "code-review", description: "Review instructions", filePath, baseDir },
    ]);

    assert.match(block, new RegExp(`^<skill name="code-review" location="${escaped(filePath)}">`));
    assert.match(block, new RegExp(`References are relative to ${escaped(baseDir)}\\.`));
    assert.match(block, /Review the diff\./);
    // Frontmatter is metadata, not instructions.
    assert.doesNotMatch(block, /description:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the exact prompt composes the profile body with the resolved skill text", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-skills-"));
  try {
    const review = await skillDir(cwd, "code-review", "Review the diff.");

    assert.match(
      composeSubagentExactPrompt(
        "Only these instructions.",
        subagentSkillPromptText({ skills: [review], scope: ["code-review"], tools: ["read"] }),
      ),
      /^Only these instructions\.\n\n<skill name="code-review"/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
