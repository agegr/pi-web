import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  filterSlashCommands,
  slashMatchRank,
  getCleanSlashName,
  buildSlashCommandLayout,
} = await jiti.import("./ChatInput.tsx");

test("getCleanSlashName strips skill: prefix but preserves builtin, prompt, and extension names", () => {
  assert.equal(getCleanSlashName({ name: "skill:copy-text", source: "skill" }), "copy-text");
  assert.equal(getCleanSlashName({ name: "copy", source: "builtin" }), "copy");
  assert.equal(getCleanSlashName({ name: "auto-copy", source: "prompt" }), "auto-copy");
  assert.equal(getCleanSlashName({ name: "weather-check", source: "extension" }), "weather-check");
  assert.equal(getCleanSlashName({ name: "mcp", source: "extension" }), "mcp");
});

test("slashMatchRank orders exact, prefix, token, and substring matches", () => {
  const exact = { name: "copy", source: "builtin" };
  const prefix = { name: "copy-session", source: "builtin" };
  const tokenHyphen = { name: "skill:deep-copy", source: "skill" };
  const tokenUnderscore = { name: "skill:deep_copy", source: "skill" };
  const substring = { name: "photocopy", source: "builtin" };
  const descriptionOnly = {
    name: "skill:better-writing",
    description: "Polish UI product copy, verb-first buttons, and error recovery",
    source: "skill",
  };

  assert.equal(slashMatchRank(exact, "copy"), 0);
  assert.equal(slashMatchRank(prefix, "copy"), 1);
  assert.equal(slashMatchRank(tokenHyphen, "copy"), 2);
  assert.equal(slashMatchRank(tokenUnderscore, "copy"), 2);
  assert.equal(slashMatchRank(substring, "copy"), 3);
  assert.equal(slashMatchRank(descriptionOnly, "copy"), 4);
});

test("slashMatchRank supports matching skills with or without explicit skill: prefix", () => {
  const skill = { name: "skill:better-writing", source: "skill" };

  // Matching without prefix
  assert.equal(slashMatchRank(skill, "better-writing"), 0);
  assert.equal(slashMatchRank(skill, "better"), 1);
  assert.equal(slashMatchRank(skill, "writing"), 2);

  // Matching with explicit skill: prefix
  assert.equal(slashMatchRank(skill, "skill:better-writing"), 0);
  assert.equal(slashMatchRank(skill, "skill:better"), 1);
});

test("filterSlashCommands suppresses noisy description-only matches when name matches exist across all sources", () => {
  const commands = [
    {
      name: "copy",
      description: "Copy the last assistant message",
      source: "builtin",
    },
    {
      name: "skill:better-writing",
      description: "Polish UI product copy, verb-first buttons, contextual error recovery, and forward-pointing empty states",
      source: "skill",
    },
    {
      name: "skill:create-agents-md",
      description: "Create, update, or audit project AGENTS.md from repository evidence without guessing or copying outdated templates",
      source: "skill",
    },
    {
      name: "skill:pen-design",
      description: "Design high-fidelity UI screens and copy layout systems in pen.dev using the 5-doc system",
      source: "skill",
    },
    {
      name: "custom-prompt",
      description: "A prompt template that mentions copying files",
      source: "prompt",
    },
    {
      name: "ext-tool",
      description: "Extension that produces a copy of the report",
      source: "extension",
    },
  ];

  const results = filterSlashCommands(commands, "copy");

  // Only the exact/name match /copy should be returned; all description mentions across skills, prompts, and extensions are suppressed
  assert.deepEqual(
    results.map((c) => c.name),
    ["copy"],
  );
});

test("filterSlashCommands preserves source priority order: builtin -> extension -> prompt -> skill on equal rank", () => {
  const commands = [
    { name: "skill:sync", source: "skill" },
    { name: "sync", source: "prompt" },
    { name: "sync", source: "builtin" },
    { name: "sync", source: "extension" },
  ];

  const results = filterSlashCommands(commands, "sync");

  // All have exact match (rank 0); must sort strictly by SLASH_SOURCE_ORDER
  assert.deepEqual(
    results.map((c) => `${c.source}:${c.name}`),
    [
      "builtin:sync",
      "extension:sync",
      "prompt:sync",
      "skill:skill:sync",
    ],
  );
});

test("filterSlashCommands falls back to description matches across all sources when no names match", () => {
  const commands = [
    {
      name: "copy",
      description: "Copy the last assistant message",
      source: "builtin",
    },
    {
      name: "weather",
      description: "Fetch assistant weather report",
      source: "extension",
    },
    {
      name: "daily-brief",
      description: "Prepare assistant morning brief",
      source: "prompt",
    },
    {
      name: "skill:code-review",
      description: "Assistant review for pull requests",
      source: "skill",
    },
    {
      name: "skill:unrelated",
      description: "Something else entirely",
      source: "skill",
    },
  ];

  const results = filterSlashCommands(commands, "assistant");

  // No command named "assistant"; fallback activates for all matching descriptions in source order
  assert.deepEqual(
    results.map((c) => `${c.source}:${c.name}`),
    [
      "builtin:copy",
      "extension:weather",
      "prompt:daily-brief",
      "skill:skill:code-review",
    ],
  );
});

test("filterSlashCommands returns all commands in source order when query is empty", () => {
  const commands = [
    { name: "skill:pen-design", source: "skill" },
    { name: "reload", source: "builtin" },
    { name: "mcp", source: "extension" },
    { name: "generate-report", source: "prompt" },
    { name: "skill:better-writing", source: "skill" },
    { name: "copy", source: "builtin" },
  ];

  const results = filterSlashCommands(commands, "");

  // Must group by source order and alphabetize within source
  assert.deepEqual(
    results.map((c) => `${c.source}:${c.name}`),
    [
      "builtin:copy",
      "builtin:reload",
      "extension:mcp",
      "prompt:generate-report",
      "skill:skill:better-writing",
      "skill:skill:pen-design",
    ],
  );
});

test("filterSlashCommands integrates with buildSlashCommandLayout and dormancy partitioning", () => {
  const commands = [
    { name: "copy", source: "builtin" },
    { name: "skill:copy-active", source: "skill" },
    { name: "skill:copy-dormant", source: "skill" },
    { name: "copy-prompt", source: "prompt" },
    { name: "copy-ext", source: "extension" },
  ];

  const filtered = filterSlashCommands(commands, "copy");
  const layout = buildSlashCommandLayout(filtered, {
    "copy-dormant": true,
    "copy-active": false,
  });

  // Verify group sources present and in order
  assert.deepEqual(
    layout.groups.map((g) => g.source),
    ["builtin", "extension", "prompt", "skill"],
  );

  // In skill group, active skill must precede dormant skill
  const skillGroup = layout.groups.find((g) => g.source === "skill");
  assert.deepEqual(
    skillGroup.items.map((i) => i.command.name),
    ["skill:copy-active", "skill:copy-dormant"],
  );

  // Layout commands array matches flattened groups
  assert.deepEqual(
    layout.commands.map((c) => c.name),
    ["copy", "copy-ext", "copy-prompt", "skill:copy-active", "skill:copy-dormant"],
  );
});

test("filterSlashCommands handles uppercase queries, missing descriptions, and regex special characters safely", () => {
  const commands = [
    { name: "copy", source: "builtin" }, // description undefined
    { name: "skill:deep-copy", source: "skill", description: undefined },
    { name: "mcp", source: "extension", description: null },
  ];

  // Uppercase query
  const upperResults = filterSlashCommands(commands, "COPY");
  assert.deepEqual(
    upperResults.map((c) => c.name),
    ["copy", "skill:deep-copy"],
  );

  // Special regex characters should not crash or throw
  const regexResults = filterSlashCommands(commands, "copy[a-z]*+?\\");
  assert.deepEqual(regexResults, []);
});
