import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagents-global-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const {
  deleteSubagentProfile,
  deleteProjectSubagentProfile,
  ejectSubagentProfile,
  listSubagentProfileSources,
  readSubagentRun,
  readSubagentSessionResources,
  saveSubagentProfile,
  saveProjectSubagentProfile,
  SubagentProfileExistsError,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  SUBAGENT_RESULT_TYPE,
} = await createJiti(import.meta.url).import("./subagents.ts");
const { isSubagentProfileOverridden } = await createJiti(import.meta.url).import("./subagent-profile-precedence.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const SCOPE_PRIORITY = { builtin: 0, global: 1, workspace: 2, project: 3 };

/** Highest-precedence source with this name, the order pi-web's panel lists sources in. */
function effectiveProfile(cwd, name) {
  return listSubagentProfileSources(cwd)
    .filter((item) => item.name.toLowerCase() === name.trim().toLowerCase())
    .sort((a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope])
    .at(-1);
}

function profile(overrides = {}) {
  return {
    name: "test-agent",
    displayName: " Test agent ",
    description: " Test description ",
    systemPrompt: " Test prompt. ",
    toolsInherited: false,
    tools: ["read", "read", "mcp:github/search"],
    excludeTools: ["bash"],
    extensions: { kind: "list", list: ["pi-advisor-flow", "./tools/child.ts"] },
    subagentOnlyExtensions: ["./tools/only.ts"],
    skills: ["safe-bash", "review-checklist"],
    skillPath: ["./skills", "../shared-skills"],
    model: " provider/model ",
    thinking: "high",
    systemPromptMode: "append",
    inheritProjectContext: true,
    inheritGlobalContext: true,
    inheritSkills: true,
    defaultContext: "fork",
    async: true,
    timeoutMs: 900000,
    toolTimeoutMs: 600000,
    maxSubagentDepth: 1,
    allowNestedSubagents: true,
    allowedAgents: ["scout", "reviewer"],
    advertise: true,
    output: "context.md",
    defaultReads: ["context.md"],
    defaultProgress: true,
    acceptanceRole: "read-only",
    aliases: ["explorer"],
    ...overrides,
  };
}

test("override detection follows scope precedence case-insensitively", () => {
  const builtin = { name: "Reviewer", scope: "builtin" };
  const global = { name: "reviewer", scope: "global" };
  const workspace = { name: "REVIEWER", scope: "workspace" };
  const project = { name: "Reviewer", scope: "project" };
  const unrelated = { name: "other", scope: "builtin" };
  const profiles = [builtin, global, workspace, project, unrelated];

  assert.equal(isSubagentProfileOverridden(builtin, profiles), true);
  assert.equal(isSubagentProfileOverridden(global, profiles), true);
  assert.equal(isSubagentProfileOverridden(workspace, profiles), true);
  assert.equal(isSubagentProfileOverridden(project, profiles), false);
  assert.equal(isSubagentProfileOverridden(unrelated, profiles), false);
});

test("a full pi-subagents profile round-trips every owned field", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const saved = saveProjectSubagentProfile(cwd, profile({ name: "explore" }));
    const loaded = effectiveProfile(cwd, "explore");

    assert.equal(loaded.displayName, "Test agent");
    assert.equal(loaded.description, "Test description");
    assert.equal(loaded.systemPrompt, "Test prompt.");
    assert.deepEqual(loaded.tools, ["read", "mcp:github/search"]);
    assert.equal(loaded.toolsInherited, false);
    assert.deepEqual(loaded.excludeTools, ["bash"]);
    assert.deepEqual(loaded.extensions, { kind: "list", list: ["pi-advisor-flow", "./tools/child.ts"] });
    assert.deepEqual(loaded.subagentOnlyExtensions, ["./tools/only.ts"]);
    assert.deepEqual(loaded.skills, ["safe-bash", "review-checklist"]);
    assert.deepEqual(loaded.skillPath, ["./skills", "../shared-skills"]);
    assert.equal(loaded.model, "provider/model");
    assert.equal(loaded.thinking, "high");
    assert.equal(loaded.systemPromptMode, "append");
    assert.equal(loaded.inheritProjectContext, true);
    assert.equal(loaded.inheritGlobalContext, true);
    assert.equal(loaded.inheritSkills, true);
    assert.equal(loaded.defaultContext, "fork");
    assert.equal(loaded.async, true);
    assert.equal(loaded.timeoutMs, 900000);
    assert.equal(loaded.toolTimeoutMs, 600000);
    assert.equal(loaded.maxSubagentDepth, 1);
    assert.equal(loaded.allowNestedSubagents, true);
    assert.deepEqual(loaded.allowedAgents, ["scout", "reviewer"]);
    assert.equal(loaded.advertise, true);
    assert.equal(loaded.output, "context.md");
    assert.deepEqual(loaded.defaultReads, ["context.md"]);
    assert.equal(loaded.defaultProgress, true);
    assert.equal(loaded.acceptanceRole, "read-only");
    assert.deepEqual(loaded.aliases, ["explorer"]);
    assert.deepEqual(saved.tools, ["read", "mcp:github/search"]);

    const source = await readFile(join(cwd, ".pi", "agents", "explore.md"), "utf8");
    assert.match(source, /systemPromptMode: append/);
    assert.match(source, /inheritProjectContext: true/);
    assert.match(source, /mcp:github\/search/);
    assert.match(source, /acceptanceRole: read-only/);
    assert.match(source, /^---/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("omitted keys stay omitted so pi-subagents defaults win", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveProjectSubagentProfile(cwd, {
      name: "minimal",
      description: "Minimal",
      systemPrompt: "Just do it.",
      toolsInherited: true,
      tools: [],
      extensions: { kind: "omit" },
    });
    const source = await readFile(join(cwd, ".pi", "agents", "minimal.md"), "utf8");
    assert.doesNotMatch(source, /^tools:/m);
    assert.doesNotMatch(source, /^extensions:/m);
    assert.doesNotMatch(source, /^systemPromptMode:/m);
    assert.doesNotMatch(source, /^timeoutMs:/m);

    const loaded = effectiveProfile(cwd, "minimal");
    assert.equal(loaded.tools, undefined);
    assert.equal(loaded.toolsInherited, true);
    assert.deepEqual(loaded.extensions, { kind: "omit" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an explicit empty allowlist is written and read back as []", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveProjectSubagentProfile(cwd, profile({ name: "chat-only", tools: [], excludeTools: undefined, extensions: { kind: "omit" } }));
    const source = await readFile(join(cwd, ".pi", "agents", "chat-only.md"), "utf8");
    // An empty list serializes as an empty scalar, the pi-subagents spelling for "no tools".
    assert.match(source, /^tools: (?:''|""|)$/m);
    assert.deepEqual(effectiveProfile(cwd, "chat-only").tools, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("tools entries are stored raw: mcp and path selectors survive", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveProjectSubagentProfile(cwd, profile({
      name: "raw",
      tools: ["read", "mcp:chrome-devtools", "./tools/child.ts", "fixture_search"],
    }));
    const loaded = effectiveProfile(cwd, "raw");
    assert.deepEqual(loaded.tools, ["read", "mcp:chrome-devtools", "./tools/child.ts", "fixture_search"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("legacy keys migrate to their pi-subagents spellings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "agents", "legacy.md"),
      [
        "---",
        "description: Legacy",
        "tools: none",
        "load_skills: true",
        "load_extensions: pi-advisor-flow",
        "inherit_context: true",
        "run_in_background: true",
        "prompt_mode: replace",
        "disallowed_tools: bash",
        "---",
        "Legacy prompt.",
      ].join("\n"),
    );
    const loaded = effectiveProfile(cwd, "legacy");
    assert.deepEqual(loaded.tools, []);
    assert.equal(loaded.inheritSkills, true);
    assert.deepEqual(loaded.extensions, { kind: "list", list: ["pi-advisor-flow"] });
    assert.equal(loaded.inheritProjectContext, true);
    assert.equal(loaded.async, true);
    assert.equal(loaded.systemPromptMode, "replace");
    assert.deepEqual(loaded.excludeTools, ["bash"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("legacy load_extensions booleans and tools sentinels map to the new tri-state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(join(cwd, ".pi", "agents", "all.md"), "---\ndescription: All\nload_extensions: true\ntools: all\n---\nAll.\n");
    await writeFile(join(cwd, ".pi", "agents", "none.md"), "---\ndescription: None\nload_extensions: false\n---\nNone.\n");

    const all = effectiveProfile(cwd, "all");
    assert.deepEqual(all.extensions, { kind: "omit" });
    assert.deepEqual(all.tools, ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

    const none = effectiveProfile(cwd, "none");
    assert.deepEqual(none.extensions, { kind: "none" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a save drops the retired pi-web keys", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "retired.md");
    await writeFile(
      file,
      [
        "---",
        "name: retired",
        "description: Retired keys",
        "display_name: retired",
        "tools: read",
        "load_skills: false",
        "load_extensions: false",
        "enabled: true",
        "inherit_context: false",
        "run_in_background: false",
        "max_turns: 8",
        "prompt_mode: append",
        "color: cyan",
        "isolation: worktree",
        "persist_session: false",
        "disallowed_tools: write",
        "allowed_subagents: thinker",
        "---",
        "Body.",
      ].join("\n"),
    );

    saveProjectSubagentProfile(cwd, profile({ name: "retired", tools: ["read"], excludeTools: undefined, extensions: { kind: "omit" } }));
    const source = await readFile(file, "utf8");
    for (const key of ["load_skills", "load_extensions", "enabled", "inherit_context", "run_in_background", "max_turns", "prompt_mode", "color", "isolation", "persist_session", "disallowed_tools"]) {
      assert.doesNotMatch(source, new RegExp(`^${key}:`, "m"), `${key} should be dropped`);
    }
    // Foreign keys another runtime owns still round-trip.
    assert.match(source, /allowed_subagents: thinker/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("list fields accept comma and block forms", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "agents", "lists.md"),
      [
        "---",
        "description: Lists",
        "tools: read, grep, find",
        "allowedAgents:",
        "  - scout",
        "  - reviewer",
        "defaultReads: a.md,b.md",
        "extensions:",
        "  - ./tools/a.ts",
        "  - ./tools/b.ts",
        "---",
        "Lists.",
      ].join("\n"),
    );
    const loaded = effectiveProfile(cwd, "lists");
    assert.deepEqual(loaded.tools, ["read", "grep", "find"]);
    assert.deepEqual(loaded.allowedAgents, ["scout", "reviewer"]);
    assert.deepEqual(loaded.defaultReads, ["a.md", "b.md"]);
    assert.deepEqual(loaded.extensions, { kind: "list", list: ["./tools/a.ts", "./tools/b.ts"] });

    // A bare `extensions:` key means "no ambient extensions".
    await writeFile(join(cwd, ".pi", "agents", "bare.md"), "---\ndescription: Bare\nextensions:\n---\nBare.\n");
    assert.deepEqual(effectiveProfile(cwd, "bare").extensions, { kind: "none" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a bare allowedAgents key denies all descendants through a save round-trip", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "deny-all.md");
    await writeFile(file, "---\ndescription: Deny all\nallowedAgents:\n---\nDeny all.\n");

    const parsed = effectiveProfile(cwd, "deny-all");
    assert.deepEqual(parsed.allowedAgents, []);
    assert.equal(parsed.allowedAgentsDenyAll, true);

    saveProjectSubagentProfile(cwd, {
      name: parsed.name,
      displayName: parsed.displayName,
      description: parsed.description,
      systemPrompt: parsed.systemPrompt,
      toolsInherited: true,
      tools: [],
      allowedAgents: parsed.allowedAgents,
      allowedAgentsDenyAll: parsed.allowedAgentsDenyAll,
      extensions: { kind: "omit" },
    });
    const source = await readFile(file, "utf8");
    assert.match(source, /^allowedAgents: (?:''|"")$/m);
    assert.deepEqual(effectiveProfile(cwd, "deny-all").allowedAgents, []);
    assert.equal(effectiveProfile(cwd, "deny-all").allowedAgentsDenyAll, true);

    // A normal list keeps its entries, and an omitted key stays omitted.
    saveProjectSubagentProfile(cwd, { name: "deny-all", description: "d", systemPrompt: "", toolsInherited: true, allowedAgents: ["scout"], extensions: { kind: "omit" } });
    assert.match(await readFile(file, "utf8"), /^allowedAgents: scout$/m);
    assert.deepEqual(effectiveProfile(cwd, "deny-all").allowedAgents, ["scout"]);
    assert.equal(effectiveProfile(cwd, "deny-all").allowedAgentsDenyAll, false);

    saveProjectSubagentProfile(cwd, { name: "deny-all", description: "d", systemPrompt: "", toolsInherited: true, extensions: { kind: "omit" } });
    const omitted = await readFile(file, "utf8");
    assert.doesNotMatch(omitted, /^allowedAgents:/m);
    assert.equal(effectiveProfile(cwd, "deny-all").allowedAgents, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("boolean thinking false parses as an explicit off and survives a save", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "off.md");
    await writeFile(file, "---\ndescription: Off\nthinking: false\n---\nOff.\n");

    const parsed = effectiveProfile(cwd, "off");
    assert.equal(parsed.thinking, "off");
    saveProjectSubagentProfile(cwd, { name: "off", description: "Off", systemPrompt: "Off.", toolsInherited: true, thinking: parsed.thinking, extensions: { kind: "omit" } });
    assert.equal(effectiveProfile(cwd, "off").thinking, "off");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the legacy skill alias feeds skills and is dropped on save", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "alias.md");
    await writeFile(file, "---\ndescription: Alias\nskill: safe-bash, review-checklist\n---\nAlias.\n");

    const parsed = effectiveProfile(cwd, "alias");
    assert.deepEqual(parsed.skills, ["safe-bash", "review-checklist"]);

    // Both present: mirror the runtime's `skill || skills` precedence (alias wins).
    await writeFile(file, "---\ndescription: Alias\nskill: from-alias\nskills: from-skills\n---\nAlias.\n");
    assert.deepEqual(effectiveProfile(cwd, "alias").skills, ["from-alias"]);

    saveProjectSubagentProfile(cwd, { name: "alias", description: "Alias", systemPrompt: "Alias.", toolsInherited: true, skills: ["safe-bash"], extensions: { kind: "omit" } });
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /^skill:/m);
    assert.match(source, /^skills: safe-bash$/m);
    assert.deepEqual(effectiveProfile(cwd, "alias").skills, ["safe-bash"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("saves reject invalid runtime values", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const saved = saveProjectSubagentProfile(cwd, profile());
    assert.equal(saved.displayName, "Test agent");
    assert.equal(saved.description, "Test description");

    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ name: "../escape" })), /Agent name may contain only/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ thinking: "extreme" })), /Invalid thinking level/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ systemPromptMode: "merge" })), /Invalid systemPromptMode/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ defaultContext: "resume" })), /Invalid defaultContext/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ acceptanceRole: "author" })), /Invalid acceptanceRole/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ timeoutMs: 0 })), /timeoutMs must be a positive integer/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ toolTimeoutMs: -5 })), /toolTimeoutMs must be a positive integer/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ toolTimeoutMs: 2_147_483_648 })), /toolTimeoutMs must be a positive integer no larger than 2147483647/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ timeoutMs: 1.5 })), /timeoutMs must be a positive integer/);
    assert.throws(() => saveProjectSubagentProfile(cwd, profile({ maxSubagentDepth: -1 })), /maxSubagentDepth must be a non-negative integer/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a profile without frontmatter keeps its filename fallback", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(join(cwd, ".pi", "agents", "plain.md"), "No frontmatter here.\n");
    const loaded = effectiveProfile(cwd, "plain");
    assert.equal(loaded.name, "plain");
    assert.equal(loaded.description, "plain");
    assert.equal(loaded.systemPrompt, "No frontmatter here.");
    assert.equal(loaded.toolsInherited, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persisted subagent metadata reconstructs the final run", () => {
  const entries = [
    {
      type: "custom",
      customType: SUBAGENT_META_TYPE,
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: "parent",
        parentSessionPath: "/tmp/parent.jsonl",
        parentToolCallId: "tool-call",
        profile: "Explore",
        description: "Find the parser",
        task: "Locate parser code",
        runInBackground: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      type: "custom",
      customType: SUBAGENT_RESULT_TYPE,
      id: "result",
      parentId: "meta",
      timestamp: "2026-01-01T00:01:00.000Z",
      data: {
        version: 1,
        status: "completed",
        completedAt: "2026-01-01T00:01:00.000Z",
        result: "Located it.",
      },
    },
  ];

  assert.deepEqual(readSubagentRun(entries, "child", "/tmp/child.jsonl"), {
    sessionId: "child",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Find the parser",
    task: "Locate parser code",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Located it.",
  });
});

test("persisted subagent resources restore the exact isolated prompt and tools", () => {
  const entries = [{
    type: "custom",
    customType: SUBAGENT_META_TYPE,
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      profile: "reviewer",
      resourceSnapshot: {
        version: 1,
        appendSystemPrompt: ["Review carefully.", "Inherited parent context."],
        tools: ["read", "grep", "web_search", "read"],
        loadSkills: true,
        loadExtensions: true,
      },
    },
  }];

  assert.deepEqual(readSubagentSessionResources(entries), {
    appendSystemPrompt: ["Review carefully.", "Inherited parent context."],
    tools: ["read", "grep", "web_search"],
    loadSkills: true,
    loadExtensions: true,
  });
});

test("legacy subagent resource snapshots keep skills and extensions disabled", () => {
  const entries = [{
    type: "custom",
    customType: SUBAGENT_META_TYPE,
    data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      resourceSnapshot: {
        version: 1,
        appendSystemPrompt: ["Stay focused."],
        tools: ["read"],
      },
    },
  }];

  assert.deepEqual(readSubagentSessionResources(entries), {
    appendSystemPrompt: ["Stay focused."],
    tools: ["read"],
    loadSkills: false,
    loadExtensions: false,
  });
});

test("project profiles override workspace profiles and deletion restores the workspace version", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".agents"), { recursive: true });
    await writeFile(
      join(cwd, ".agents", "test-agent.md"),
      "---\ndescription: Workspace version\ntools: read\n---\nWorkspace prompt.\n",
    );
    saveProjectSubagentProfile(cwd, profile({ description: "Project version" }));
    assert.equal(effectiveProfile(cwd, "TEST-AGENT").description, "Project version");

    deleteProjectSubagentProfile(cwd, "test-agent");
    const restored = effectiveProfile(cwd, "test-agent");
    assert.equal(restored.scope, "workspace");
    assert.equal(restored.description, "Workspace version");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a session in a subdirectory reads project profiles from the nearest project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(root, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(root, ".pi", "agents", "rooted.md"),
      "---\nname: rooted\ndescription: Defined at the project root\ntools: read\n---\nRoot prompt.\n",
    );
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });

    assert.equal(effectiveProfile(nested, "rooted").scope, "project");
    const saved = saveProjectSubagentProfile(nested, profile({ name: "nested", description: "From the subdirectory" }));
    assert.equal(saved.filePath, join(root, ".pi", "agents", "nested.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global and project sources with the same name stay visible while project wins at runtime", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveSubagentProfile(cwd, "global", profile({ description: "Global version" }));
    saveSubagentProfile(cwd, "project", profile({ description: "Project version" }));

    const sources = listSubagentProfileSources(cwd)
      .filter((item) => item.name === "test-agent")
      .sort((a, b) => a.scope.localeCompare(b.scope));
    assert.deepEqual(sources.map((item) => item.scope), ["global", "project"]);
    assert.deepEqual(sources.map((item) => item.description), ["Global version", "Project version"]);

    const effective = effectiveProfile(cwd, "test-agent");
    assert.equal(effective.scope, "project");
    assert.equal(effective.description, "Project version");
  } finally {
    deleteSubagentProfile(cwd, "global", "test-agent");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persisted runs distinguish interrupted, failed, aborted, and latest results", () => {
  const meta = {
    type: "custom",
    customType: SUBAGENT_META_TYPE,
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect",
      task: "Inspect files",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
  assert.equal(readSubagentRun([meta], "child", "/tmp/child.jsonl").status, "interrupted");

  const failed = {
    ...meta,
    id: "failed",
    customType: SUBAGENT_RESULT_TYPE,
    data: { version: 1, status: "failed", completedAt: "2026-01-01T00:01:00.000Z", error: "boom" },
  };
  const aborted = {
    ...failed,
    id: "aborted",
    data: { version: 1, status: "aborted", completedAt: "2026-01-01T00:02:00.000Z" },
  };
  assert.equal(readSubagentRun([meta, failed], "child", "/tmp/child.jsonl").status, "failed");
  assert.equal(readSubagentRun([meta, failed], "child", "/tmp/child.jsonl").error, "boom");
  assert.equal(readSubagentRun([meta, failed, aborted], "child", "/tmp/child.jsonl").status, "aborted");
  const resumed = { ...failed, id: "resumed", customType: SUBAGENT_STATUS_TYPE, data: { version: 1, status: "queued" } };
  assert.equal(readSubagentRun([meta, failed, resumed], "child", "/tmp/child.jsonl").status, "queued");
  assert.equal(readSubagentRun([{ ...meta, data: { version: 2 } }], "child", "/tmp/child.jsonl"), null);
});

test("project profile directories cannot escape the nearest project root through symbolic links", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-web-subagent-boundary-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = join(base, "project", "nested");
  const outside = join(base, "outside");
  await mkdir(join(base, "project", ".agents"), { recursive: true });
  await mkdir(join(base, "project", ".pi"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "---\ndescription: Secret\n---\nprivate\n");

  try {
    await symlink(outside, join(base, "project", ".agents", "agents"), process.platform === "win32" ? "junction" : "dir");
    await symlink(outside, join(base, "project", ".pi", "agents"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  assert.equal(listSubagentProfileSources(cwd).some((item) => item.name === "secret"), false);
  assert.throws(
    () => saveProjectSubagentProfile(cwd, profile({ name: "escaped" })),
    /outside the project root/,
  );
  assert.throws(
    () => deleteProjectSubagentProfile(cwd, "secret"),
    /outside the project root/,
  );
  assert.match(await readFile(join(outside, "secret.md"), "utf8"), /private/);
});

test("a save keeps frontmatter keys this app does not manage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "orchestrator.md");
    await writeFile(
      file,
      [
        "---",
        "name: orchestrator",
        "description: Hands out work",
        "display_name: orchestrator",
        "tools: read, bash, ext:pi-advisor-flow/ask_advisor",
        "exclude_extensions: pi-advisor-flow",
        "allowed_subagents: thinker, executor",
        "mutationTools: write_file",
        "---",
        "Dispatch the work.",
      ].join("\n"),
    );

    saveProjectSubagentProfile(cwd, profile({ name: "orchestrator", tools: ["read", "bash", "ext:pi-advisor-flow/ask_advisor"], excludeTools: undefined, extensions: { kind: "omit" } }));
    const source = await readFile(file, "utf8");

    assert.match(source, /^name: orchestrator$/m);
    assert.match(source, /allowed_subagents: thinker, executor/);
    assert.match(source, /exclude_extensions: pi-advisor-flow/);
    assert.match(source, /mutationTools: write_file/);
    assert.match(source, /Test prompt\./);

    const loaded = effectiveProfile(cwd, "orchestrator");
    assert.deepEqual(loaded.tools, ["read", "bash", "ext:pi-advisor-flow/ask_advisor"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a save refuses to overwrite malformed existing frontmatter", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "malformed.md");
    const source = "---\nallowed_subagents: [executor\n---\nKeep this file intact.\n";
    await writeFile(file, source);

    assert.throws(
      () => saveProjectSubagentProfile(cwd, profile({ name: "malformed" })),
      /existing frontmatter is invalid/,
    );
    assert.equal(await readFile(file, "utf8"), source);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const EJECT_SOURCE = [
  "---",
  "name: reviewer",
  "description: Bundled reviewer",
  "thinking: high",
  "customKey: preserved",
  "---",
  "Review the diff.",
  "",
].join("\n");

async function writeEjectSource() {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-eject-source-"));
  const file = join(dir, "reviewer.md");
  await writeFile(file, EJECT_SOURCE);
  return { dir, file };
}

test("eject copies the source file verbatim into the global agent directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const source = await writeEjectSource();
  try {
    const copied = ejectSubagentProfile(cwd, "global", source.file, "reviewer", "builtin");
    assert.equal(copied.name, "reviewer");
    assert.equal(copied.scope, "global");
    const target = join(testAgentDir, "agents", "reviewer.md");
    assert.equal(await readFile(target, "utf8"), EJECT_SOURCE);
    // A key outside the managed set survives the verbatim copy.
    assert.equal(copied.description, "Bundled reviewer");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(source.dir, { recursive: true, force: true });
    await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  }
});

test("eject into the project scope targets the nearest project agent directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const source = await writeEjectSource();
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    const copied = ejectSubagentProfile(cwd, "project", source.file, "reviewer", "builtin");
    assert.equal(copied.scope, "project");
    assert.equal(await readFile(join(cwd, ".pi", "agents", "reviewer.md"), "utf8"), EJECT_SOURCE);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(source.dir, { recursive: true, force: true });
  }
});

test("eject uses the requested name for the target file and validates it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const source = await writeEjectSource();
  try {
    const copied = ejectSubagentProfile(cwd, "global", source.file, "my-reviewer", "builtin");
    assert.equal(copied.filePath, join(testAgentDir, "agents", "my-reviewer.md"));
    // The copy is verbatim, so the frontmatter name is unchanged.
    assert.equal(copied.name, "reviewer");
    assert.throws(() => ejectSubagentProfile(cwd, "global", source.file, "../escape", "builtin"), /Agent name may contain only/);
    assert.equal(await readFile(join(testAgentDir, "agents", "my-reviewer.md"), "utf8"), EJECT_SOURCE);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(source.dir, { recursive: true, force: true });
    await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  }
});

test("eject refuses to overwrite an existing target file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const source = await writeEjectSource();
  try {
    await mkdir(join(testAgentDir, "agents"), { recursive: true });
    await writeFile(join(testAgentDir, "agents", "reviewer.md"), "keep me\n");
    assert.throws(
      () => ejectSubagentProfile(cwd, "global", source.file, "reviewer", "builtin"),
      SubagentProfileExistsError,
    );
    assert.equal(await readFile(join(testAgentDir, "agents", "reviewer.md"), "utf8"), "keep me\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(source.dir, { recursive: true, force: true });
    await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  }
});

test("eject rejects a source that does not exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    assert.throws(
      () => ejectSubagentProfile(cwd, "global", join(cwd, "missing.md"), "missing", "builtin"),
      /Source agent file not found/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("eject only duplicates builtin and package agents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const source = await writeEjectSource();
  try {
    for (const scope of ["user", "project"]) {
      assert.throws(
        () => ejectSubagentProfile(cwd, "global", source.file, "reviewer", scope),
        /Only built-in and package agents can be duplicated/,
      );
    }
    // The rejection happens before any file is written.
    await assert.rejects(readFile(join(testAgentDir, "agents", "reviewer.md"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(source.dir, { recursive: true, force: true });
    await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  }
});

test("eject deletes the copy when it does not parse as a profile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  const dir = await mkdtemp(join(tmpdir(), "pi-web-eject-bad-"));
  const file = join(dir, "bad.md");
  // The frontmatter name is invalid, so the copy would be invisible to the editor.
  await writeFile(file, "---\nname: ../evil\ndescription: Bad\n---\nbody\n");
  try {
    assert.throws(
      () => ejectSubagentProfile(cwd, "global", file, "bad", "builtin"),
      /could not be parsed as a profile/,
    );
    await assert.rejects(readFile(join(testAgentDir, "agents", "bad.md"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
    await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  }
});
