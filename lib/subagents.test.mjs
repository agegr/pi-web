import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  listSubagentProfileSources,
  listSubagentProfiles,
  readSubagentRun,
  readSubagentSessionResources,
  resolveSubagentProfile,
  saveSubagentProfile,
  saveProjectSubagentProfile,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  SUBAGENT_RESULT_TYPE,
  withSubagentExtensionTools,
  selectSubagentExtensionTools,
} = await createJiti(import.meta.url).import("./subagents.ts");
const { isSubagentProfileOverridden } = await createJiti(import.meta.url).import("./subagent-profile-precedence.ts");
const { writeDisabledBuiltInSubagent } = await createJiti(import.meta.url).import("./subagent-settings.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function profile(overrides = {}) {
  return {
    name: "test-agent",
    displayName: " Test agent ",
    description: " Test description ",
    systemPrompt: " Test prompt. ",
    tools: ["read", "read", "unknown-tool"],
    loadSkills: false,
    loadExtensions: false,
    model: " provider/model ",
    thinking: "high",
    maxTurns: 4.9,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    ...overrides,
  };
}

test("built-in profile IDs use lowercase kebab-case and read-only profiles cannot execute shell commands", () => {
  const profiles = listSubagentProfiles(testAgentDir);
  for (const builtin of profiles.filter((item) => item.scope === "builtin")) {
    assert.match(builtin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
  for (const name of ["explore", "plan"]) {
    const builtin = profiles.find((item) => item.name === name);
    assert.deepEqual(builtin.tools, ["read", "grep", "find", "ls"]);
    assert.equal(builtin.tools.includes("bash"), false);
  }
});

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

test("project profiles override built-ins and round-trip their runtime settings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveProjectSubagentProfile(cwd, {
      name: "Explore",
      displayName: "Repository scout",
      description: "Inspect this repository",
      systemPrompt: "Read carefully and report findings.",
      tools: ["read", "grep"],
      loadSkills: true,
      loadExtensions: true,
      model: "anthropic/test-model",
      thinking: "high",
      maxTurns: 8,
      inheritContext: true,
      runInBackground: true,
      enabled: true,
    });

    const profile = listSubagentProfiles(cwd).find((item) => item.name === "Explore");
    assert.equal(profile.scope, "project");
    assert.equal(profile.displayName, "Repository scout");
    assert.deepEqual(profile.tools, ["read", "grep"]);
    assert.equal(profile.loadSkills, true);
    assert.equal(profile.loadExtensions, true);
    assert.equal(profile.thinking, "high");
    assert.equal(profile.maxTurns, 8);
    assert.equal(profile.inheritContext, true);
    assert.equal(profile.runInBackground, true);

    const source = await readFile(join(cwd, ".pi", "agents", "Explore.md"), "utf8");
    assert.match(source, /max_turns: 8/);
    assert.match(source, /load_skills: true/);
    assert.match(source, /load_extensions: true/);
    assert.match(source, /Read carefully and report findings\./);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("tintinweb extension selectors stay scoped to the selected extension tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "agents", "legacy.md"),
      "---\ndescription: Legacy\ntools: read, ext:mcp/search, write\ndisallowed_tools: write\n---\nInspect only.\n",
    );
    const profile = listSubagentProfiles(cwd).find((item) => item.name === "legacy");
    assert.deepEqual(profile.tools, ["read"]);
    assert.deepEqual(profile.extensionTools, ["ext:mcp/search"]);
    assert.equal(profile.loadSkills, false);
    assert.equal(profile.loadExtensions, true);
    const extensions = [
      { path: "/tmp/mcp/index.ts", sourceInfo: { source: "mcp" }, tools: new Map([["search", {}], ["admin", {}]]) },
      { path: "/tmp/other/index.ts", sourceInfo: { source: "other" }, tools: new Map([["search", {}]]) },
    ];
    assert.deepEqual(selectSubagentExtensionTools(extensions, profile.extensionTools), ["search"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const EXTENSION_FIXTURES = [
  {
    path: "C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\@vndv\\pi-codegraph\\extensions\\codegraph.ts",
    sourceInfo: { source: "npm:@vndv/pi-codegraph", origin: "package" },
    tools: new Map([["codegraph_search", {}], ["codegraph_status", {}]]),
  },
  {
    path: "C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\pi-web-access\\index.ts",
    sourceInfo: { source: "npm:pi-web-access", origin: "package" },
    tools: new Map([["web_search", {}]]),
  },
  // a second package shipping from an `extensions/` directory, so that directory name is
  // ambiguous here — exactly as it is on a real install
  {
    path: "C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\pi-quota-monitoring\\extensions\\quota.ts",
    sourceInfo: { source: "npm:pi-quota-monitoring", origin: "package" },
    tools: new Map([["quota_status", {}]]),
  },
];
const EXTENSION_FIXTURE_TOOLS = ["codegraph_search", "codegraph_status", "web_search", "quota_status"];

test("extension selectors resolve scoped npm names and unambiguous short names", () => {
  // scoped npm source name addresses the whole extension and a single tool
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:@vndv/pi-codegraph"]), ["codegraph_search", "codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:@vndv/pi-codegraph/codegraph_status"]), ["codegraph_status"]);
  // unscoped source name and the file basename
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:pi-codegraph/codegraph_status"]), ["codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/codegraph_status"]), ["codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:pi-web-access"]), ["web_search"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:quota"]), ["quota_status"]);
  // two packages share the `extensions/` parent directory, so that spelling is refused
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:extensions"]), []);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:extensions/codegraph_search"]), []);
});

test("a pinned npm source contributes its package name, not the pin", () => {
  const pinned = [
    {
      path: "/tmp/pinned/extensions/codegraph.ts",
      sourceInfo: { source: "npm:@vndv/pi-codegraph@0.3.1", origin: "package" },
      tools: new Map([["codegraph_status", {}]]),
    },
    {
      path: "/tmp/plain/index.ts",
      sourceInfo: { source: "npm:pi-web-access@2.0.0", origin: "package" },
      tools: new Map([["web_search", {}]]),
    },
  ];
  assert.deepEqual(selectSubagentExtensionTools(pinned, ["ext:@vndv/pi-codegraph"]), ["codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(pinned, ["ext:pi-codegraph"]), ["codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(pinned, ["ext:pi-web-access/web_search"]), ["web_search"]);
});

test("one package shipping several extension files stays addressable as a unit", () => {
  const onePackage = [
    { path: "/tmp/toolbox/extensions/alpha.ts", sourceInfo: { source: "npm:pi-toolbox", origin: "package" }, tools: new Map([["alpha_tool", {}]]) },
    { path: "/tmp/toolbox/extensions/beta.ts", sourceInfo: { source: "npm:pi-toolbox", origin: "package" }, tools: new Map([["beta_tool", {}]]) },
  ];
  // sharing a name inside one source is not a collision
  assert.deepEqual(selectSubagentExtensionTools(onePackage, ["ext:pi-toolbox"]), ["alpha_tool", "beta_tool"]);
  assert.deepEqual(selectSubagentExtensionTools(onePackage, ["ext:alpha"]), ["alpha_tool"]);
  assert.deepEqual(selectSubagentExtensionTools(onePackage, ["ext:beta/beta_tool"]), ["beta_tool"]);
});

test("extension selectors keep wildcard, trailing-slash and name/* semantics", () => {
  // `*` stays global; whitespace around it is tolerated
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:*"]), EXTENSION_FIXTURE_TOOLS);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext: *"]), EXTENSION_FIXTURE_TOOLS);
  // both `name/` and `name/*` mean the whole extension, and a trailing slash after `/*` stays inert
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/"]), ["codegraph_search", "codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/*"]), ["codegraph_search", "codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/*/"]), ["codegraph_search", "codegraph_status"]);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:mcp/*"]).length, 0);
  // known + unknown selectors are additive; unknown ones contribute nothing
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/codegraph_status", "ext:nope"]), ["codegraph_status"]);
  // a deeper segment is not truncated into a tool name
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:codegraph/codegraph_status/extra"]), []);
  // `ext:*/` normalizes to the global wildcard, but only a bare `*` is the wildcard
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:*/"],), EXTENSION_FIXTURE_TOOLS);
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["ext:**/"]), []);
  // non-`ext:` entries are not treated as selectors
  assert.deepEqual(selectSubagentExtensionTools(EXTENSION_FIXTURES, ["write", "ext:"]), []);
});

test("a shared basename or unscoped name stays unaddressable", () => {
  const sharedBasename = [
    { path: "/tmp/alpha/index.ts", sourceInfo: { source: "npm:alpha", origin: "package" }, tools: new Map([["alpha_tool", {}]]) },
    { path: "/tmp/beta/index.ts", sourceInfo: { source: "npm:beta", origin: "package" }, tools: new Map([["beta_tool", {}]]) },
  ];
  // `ext:index` would grant tools from unrelated extensions, so it must select nothing
  assert.deepEqual(selectSubagentExtensionTools(sharedBasename, ["ext:index"]), []);
  // the unambiguous names still work
  assert.deepEqual(selectSubagentExtensionTools(sharedBasename, ["ext:alpha"]), ["alpha_tool"]);
  assert.deepEqual(selectSubagentExtensionTools(sharedBasename, ["ext:beta"]), ["beta_tool"]);

  // two scoped packages share both the unscoped name and the `extensions/` parent directory
  const sharedUnscoped = [
    { path: "/tmp/a/extensions/one.ts", sourceInfo: { source: "npm:@org-a/tool", origin: "package" }, tools: new Map([["tool_a", {}]]) },
    { path: "/tmp/b/extensions/two.ts", sourceInfo: { source: "npm:@org-b/tool", origin: "package" }, tools: new Map([["tool_b", {}]]) },
  ];
  assert.deepEqual(selectSubagentExtensionTools(sharedUnscoped, ["ext:tool"]), []);
  assert.deepEqual(selectSubagentExtensionTools(sharedUnscoped, ["ext:extensions"]), []);
  assert.deepEqual(selectSubagentExtensionTools(sharedUnscoped, ["ext:@org-a/tool"]), ["tool_a"]);
});

test("a longer name wins over a shorter unrelated one", () => {
  const scopeDir = [
    {
      path: "/home/u/.pi/agent/npm/node_modules/@vndv/helper.ts",
      sourceInfo: { source: "npm:@vndv/helper", origin: "package" },
      tools: new Map([["pi-codegraph", {}]]),
    },
    {
      path: "/home/u/.pi/agent/npm/node_modules/@vndv/pi-codegraph/extensions/codegraph.ts",
      sourceInfo: { source: "npm:@vndv/pi-codegraph", origin: "package" },
      tools: new Map([["codegraph_search", {}]]),
    },
  ];
  // resolving per extension would let the short name `@vndv` claim this selector and grant
  // `pi-codegraph` from the other package
  assert.deepEqual(selectSubagentExtensionTools(scopeDir, ["ext:@vndv/pi-codegraph"]), ["codegraph_search"]);
});

test("auto-discovered and settings-listed extensions are never one unit", () => {
  // SDK PathMetadata gives every top-level resource the shared source "auto" (scanned) or
  // "local" (settings entry), so the unit identity has to come from the path instead —
  // otherwise the name gate sees one owner and hands out both extensions' tools.
  const autoDiscovered = [
    { path: "/home/u/.pi/agent/extensions/alpha/index.ts", sourceInfo: { source: "auto", origin: "top-level" }, tools: new Map([["alpha_tool", {}]]) },
    { path: "/home/u/.pi/agent/extensions/beta/index.ts", sourceInfo: { source: "auto", origin: "top-level" }, tools: new Map([["beta_tool", {}]]) },
  ];
  assert.deepEqual(selectSubagentExtensionTools(autoDiscovered, ["ext:index"]), []);
  assert.deepEqual(selectSubagentExtensionTools(autoDiscovered, ["ext:auto"]), []);
  // per-file names still work
  assert.deepEqual(selectSubagentExtensionTools(autoDiscovered, ["ext:alpha"]), ["alpha_tool"]);
  assert.deepEqual(selectSubagentExtensionTools(autoDiscovered, ["ext:beta/beta_tool"]), ["beta_tool"]);

  const settingsListed = [
    { path: "/home/u/.pi/agent/extensions/one.ts", sourceInfo: { source: "local", origin: "top-level" }, tools: new Map([["one_tool", {}]]) },
    { path: "/home/u/.pi/agent/extensions/two.ts", sourceInfo: { source: "local", origin: "top-level" }, tools: new Map([["two_tool", {}]]) },
  ];
  assert.deepEqual(selectSubagentExtensionTools(settingsListed, ["ext:local"]), []);
  assert.deepEqual(selectSubagentExtensionTools(settingsListed, ["ext:extensions"]), []);
  assert.deepEqual(selectSubagentExtensionTools(settingsListed, ["ext:one"]), ["one_tool"]);
});

test("a denied extension covers selectors scoped below it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-deny-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const write = (name, tools, disallowed) => writeFile(
      join(cwd, ".pi", "agents", `${name}.md`),
      `---\ndescription: ${name}\ntools: ${tools}\n${disallowed ? `disallowed_tools: ${disallowed}\n` : ""}---\nInspect only.\n`,
    );
    const load = (name) => listSubagentProfiles(cwd).find((item) => item.name === name);

    await write("control", "read, ext:codegraph/codegraph_search");
    await write("scoped", "read, ext:codegraph/codegraph_search", "ext:codegraph");
    await write("star", "read, ext:codegraph/*", "ext:codegraph");
    assert.deepEqual(load("control").extensionTools, ["ext:codegraph/codegraph_search"]);
    assert.deepEqual(load("scoped").extensionTools ?? [], []);
    assert.deepEqual(load("star").extensionTools ?? [], []);

    // A tool-scoped deny narrows a whole-extension allow only at spawn time, where the
    // loaded extensions supply the tool names: the raw selector stays for the runtime to
    // resolve, and `disallowedExtensionTools` carries it there.
    await write("narrow", "read, ext:codegraph/*", "ext:codegraph/codegraph_search");
    assert.deepEqual(load("narrow").extensionTools, ["ext:codegraph/*"]);
    assert.deepEqual(load("narrow").disallowedExtensionTools, ["ext:codegraph/codegraph_search"]);

    // A global deny removes every extension tool whatever the allow side says.
    await write("deny-all", "read, ext:codegraph/*", "ext:*");
    assert.deepEqual(load("deny-all").extensionTools ?? [], []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("deny selectors are resolved against the same aliases as the grant", () => {
  const extensions = [{
    path: "/n/node_modules/@vndv/pi-codegraph/extensions/codegraph.ts",
    sourceInfo: { source: "npm:@vndv/pi-codegraph", origin: "package" },
    tools: new Map([["codegraph_search", {}], ["codegraph_status", {}]]),
  }];
  const grant = ["ext:@vndv/pi-codegraph/codegraph_search"];

  // the alias mismatch that used to slip through every gate
  assert.deepEqual(selectSubagentExtensionTools(extensions, grant, []), ["codegraph_search"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, grant, ["ext:codegraph"]), []);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:codegraph"], ["ext:@vndv/pi-codegraph/codegraph_search"]), ["codegraph_status"]);
  // a global deny beats any grant, and an unrelated name denies nothing
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:codegraph"], ["ext:*"]), []);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:codegraph"], ["ext:index"]), ["codegraph_search", "codegraph_status"]);
  // a tool-scoped deny narrows a whole-extension grant
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:codegraph/*"], ["ext:codegraph/codegraph_status"]), ["codegraph_search"]);
});

test("an uppercase EXT: selector round-trips and a denied extension blocks its star spelling", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-ext-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const upperFile = join(cwd, ".pi", "agents", "upper.md");
    await writeFile(upperFile, "---\ndescription: Upper\ntools: read, EXT:pi-advisor-flow/ask_advisor\n---\nInspect only.\n");
    saveProjectSubagentProfile(cwd, profile({ name: "upper", tools: ["read", "bash"] }));
    assert.match(await readFile(upperFile, "utf8"), /tools: read, bash, EXT:pi-advisor-flow\/ask_advisor/);

    // denying the extension has to block the star spelling too — comparing raw strings missed it
    await writeFile(
      join(cwd, ".pi", "agents", "denied.md"),
      "---\ndescription: Denied\ntools: read, ext:codegraph/*\ndisallowed_tools: ext:codegraph\n---\nInspect only.\n",
    );
    // control: the same selector without the deny rule survives
    await writeFile(
      join(cwd, ".pi", "agents", "allowed.md"),
      "---\ndescription: Allowed\ntools: read, ext:codegraph/*\n---\nInspect only.\n",
    );
    const denied = listSubagentProfiles(cwd).find((item) => item.name === "denied");
    const allowed = listSubagentProfiles(cwd).find((item) => item.name === "allowed");
    assert.deepEqual(allowed.extensionTools, ["ext:codegraph/*"]);
    assert.deepEqual(denied.tools, ["read"]);
    // an empty extension selection is omitted from the profile
    assert.deepEqual(denied.extensionTools ?? [], []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("tool names stay case-sensitive while extension names do not", () => {
  const extensions = [
    { path: "/tmp/mcp/index.ts", sourceInfo: { source: "mcp" }, tools: new Map([["Search", {}], ["admin", {}]]) },
  ];
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:mcp/Search"]), ["Search"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:MCP/Search"]), ["Search"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:mcp/search"]), []);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:mcp"]), ["Search", "admin"]);
});

test("reads tintinweb profile aliases and frontmatter identity", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-tintin-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(join(cwd, ".pi", "agents", "review.md"), `---
name: security-review
color: cyan
skills: true
extensions: false
prompt_mode: replace
isolation: worktree
persist_session: false
disallowed_tools: bash
---
Review securely.
`);
    const profile = resolveSubagentProfile(cwd, "security-review");
    assert.equal(profile.name, "security-review");
    assert.equal(profile.loadSkills, true);
    assert.equal(profile.loadExtensions, false);
    assert.equal(profile.promptMode, "replace");
    assert.equal(profile.color, "cyan");
    assert.equal(profile.isolation, "worktree");
    assert.equal(profile.persistSession, false);
    assert.equal(profile.tools.includes("bash"), false);
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

test("extension tools are merged while subagent control tools stay excluded", () => {
  assert.deepEqual(
    withSubagentExtensionTools(
      ["read"],
      ["web_search", "Agent", "get_subagent_result", "steer_subagent", "web_search"],
    ),
    ["read", "web_search"],
  );
});

test("an empty tool selection round-trips without restoring default tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const saved = saveProjectSubagentProfile(cwd, profile({ tools: [] }));
    const loaded = listSubagentProfiles(cwd).find((item) => item.name === saved.name);
    const source = await readFile(join(cwd, ".pi", "agents", `${saved.name}.md`), "utf8");

    assert.deepEqual(saved.tools, []);
    assert.deepEqual(loaded.tools, []);
    assert.match(source, /tools: none/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("saved profiles normalize runtime values and reject invalid settings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const saved = saveProjectSubagentProfile(cwd, profile());
    assert.equal(saved.displayName, "Test agent");
    assert.equal(saved.description, "Test description");
    assert.equal(saved.systemPrompt, "Test prompt.");
    assert.deepEqual(saved.tools, ["read"]);
    assert.equal(saved.model, "provider/model");
    assert.equal(saved.maxTurns, 4);
    assert.equal(saved.loadSkills, false);
    assert.equal(saved.loadExtensions, false);

    assert.throws(
      () => saveProjectSubagentProfile(cwd, profile({ name: "../escape" })),
      /Agent name may contain only/,
    );
    assert.throws(
      () => saveProjectSubagentProfile(cwd, profile({ thinking: "extreme" })),
      /Invalid thinking level/,
    );
    assert.throws(
      () => saveProjectSubagentProfile(cwd, profile({ maxTurns: Number.POSITIVE_INFINITY })),
      /Max turns must be a non-negative number/,
    );
    assert.throws(
      () => saveProjectSubagentProfile(cwd, profile({ maxTurns: -1 })),
      /Max turns must be a non-negative number/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("project profiles override workspace profiles and deletion restores the workspace version", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".agents", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".agents", "agents", "test-agent.md"),
      "---\ndescription: Workspace version\ntools: read\n---\nWorkspace prompt.\n",
    );
    saveProjectSubagentProfile(cwd, profile({ description: "Project version" }));
    assert.equal(resolveSubagentProfile(cwd, "TEST-AGENT").description, "Project version");

    deleteProjectSubagentProfile(cwd, "test-agent");
    const restored = resolveSubagentProfile(cwd, "test-agent");
    assert.equal(restored.scope, "workspace");
    assert.equal(restored.description, "Workspace version");
  } finally {
    await rm(cwd, { recursive: true, force: true });
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

    const effective = resolveSubagentProfile(cwd, "test-agent");
    assert.equal(effective.scope, "project");
    assert.equal(effective.description, "Project version");
  } finally {
    deleteSubagentProfile(cwd, "global", "test-agent");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("global profiles round-trip and deleting an override restores the built-in", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const saved = saveSubagentProfile(cwd, "global", profile({
      name: "Explore",
      displayName: "Global explorer",
      description: "Global override",
      tools: ["read", "grep"],
    }));
    assert.equal(saved.scope, "global");
    assert.equal(saved.filePath, join(testAgentDir, "agents", "Explore.md"));
    assert.equal(resolveSubagentProfile(cwd, "Explore").scope, "global");
    assert.equal(resolveSubagentProfile(cwd, "Explore").description, "Global override");

    deleteSubagentProfile(cwd, "global", "Explore");
    const restored = resolveSubagentProfile(cwd, "Explore");
    assert.equal(restored.scope, "builtin");
    assert.equal(restored.displayName, "Explore");
  } finally {
    deleteSubagentProfile(cwd, "global", "Explore");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a built-in is switched off through settings.json, not a copied-out file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    writeDisabledBuiltInSubagent("Explore", true);

    const builtin = listSubagentProfileSources(cwd).find((item) => item.scope === "builtin" && item.name === "explore");
    assert.equal(builtin.enabled, false);
    assert.equal(builtin.filePath, undefined);
    assert.equal(existsSync(join(testAgentDir, "agents", "explore.md")), false);
    assert.equal(resolveSubagentProfile(cwd, "explore"), undefined);
    // Only the named built-in is affected.
    assert.equal(resolveSubagentProfile(cwd, "plan").scope, "builtin");

    // A same-name file replaces the built-in outright, so its own `enabled` decides.
    saveSubagentProfile(cwd, "global", profile({ name: "explore", description: "Global override" }));
    const overriding = resolveSubagentProfile(cwd, "explore");
    assert.equal(overriding.scope, "global");
    assert.equal(overriding.description, "Global override");
    deleteSubagentProfile(cwd, "global", "explore");

    writeDisabledBuiltInSubagent("explore", false);
    assert.equal(resolveSubagentProfile(cwd, "explore").scope, "builtin");
  } finally {
    writeDisabledBuiltInSubagent("explore", false);
    deleteSubagentProfile(cwd, "global", "explore");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("disabled profiles cannot be resolved for execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    saveSubagentProfile(cwd, "global", profile({ description: "Global version" }));
    saveProjectSubagentProfile(cwd, profile({ enabled: false }));
    const sources = listSubagentProfileSources(cwd).filter((item) => item.name === "test-agent");
    const globalProfile = sources.find((item) => item.scope === "global");
    const projectProfile = sources.find((item) => item.scope === "project");

    assert.equal(isSubagentProfileOverridden(globalProfile, sources), true);
    assert.equal(isSubagentProfileOverridden(projectProfile, sources), false);
    assert.equal(resolveSubagentProfile(cwd, "test-agent"), undefined);
    assert.equal(listSubagentProfiles(cwd).find((item) => item.name === "test-agent").enabled, false);
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

test("project profile directories cannot escape cwd through symbolic links", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-web-subagent-boundary-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = join(base, "project");
  const outside = join(base, "outside");
  await mkdir(join(cwd, ".agents"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "---\ndescription: Secret\n---\nprivate\n");

  try {
    await symlink(outside, join(cwd, ".agents", "agents"), process.platform === "win32" ? "junction" : "dir");
    await symlink(outside, join(cwd, ".pi", "agents"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  assert.equal(listSubagentProfileSources(cwd).some((item) => item.name === "secret"), false);
  assert.equal(listSubagentProfiles(cwd).some((item) => item.name === "secret"), false);
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
        "tools: read, bash, edit, write, grep, find, ls, ext:pi-advisor-flow/ask_advisor",
        "skills: false",
        "extensions: pi-advisor-flow",
        "exclude_extensions: pi-advisor-flow",
        "allowed_subagents: thinker, executor",
        "disallowed_tools: write",
        "enabled: true",
        "inherit_context: false",
        "run_in_background: false",
        "---",
        "Dispatch the work.",
      ].join("\n"),
    );

    saveProjectSubagentProfile(cwd, profile({ name: "orchestrator", tools: ["read", "bash"] }));
    const source = await readFile(file, "utf8");

    assert.match(source, /^name: orchestrator$/m);
    assert.match(source, /allowed_subagents: thinker, executor/);
    assert.match(source, /exclude_extensions: pi-advisor-flow/);
    assert.match(source, /disallowed_tools: write/);
    assert.match(source, /skills: false/);
    assert.match(source, /extensions: pi-advisor-flow/);
    assert.match(source, /tools: read, bash, ext:pi-advisor-flow\/ask_advisor/);
    assert.match(source, /Test prompt\./);

    const loaded = listSubagentProfiles(cwd).find((item) => item.name === "orchestrator");
    assert.deepEqual(loaded.tools, ["read", "bash"]);
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

test("the pi-subagents flag aliases are seeded, kept in step, and never overwrite a whitelist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    const file = join(cwd, ".pi", "agents", "fresh.md");
    saveProjectSubagentProfile(cwd, profile({ name: "fresh", loadSkills: true, loadExtensions: true }));
    const seeded = await readFile(file, "utf8");
    assert.match(seeded, /load_skills: true/);
    assert.match(seeded, /skills: true/);
    assert.match(seeded, /load_extensions: true/);
    assert.match(seeded, /extensions: true/);

    saveProjectSubagentProfile(cwd, profile({ name: "fresh", loadSkills: false, loadExtensions: false }));
    const flipped = await readFile(file, "utf8");
    assert.match(flipped, /skills: false/);
    assert.match(flipped, /extensions: false/);

    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    const scoped = join(cwd, ".pi", "agents", "scoped.md");
    await writeFile(scoped, "---\ndescription: Scoped\nextensions: pi-advisor-flow\n---\nOnly the advisor.\n");
    saveProjectSubagentProfile(cwd, profile({ name: "scoped", loadExtensions: true }));
    assert.match(await readFile(scoped, "utf8"), /extensions: pi-advisor-flow/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("profile flags fall back to the pi-subagents spellings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "agents", "legacy-flags.md"),
      "---\ndescription: Legacy flags\nskills: false\nextensions: pi-advisor-flow\n---\nScoped.\n",
    );

    const loaded = listSubagentProfiles(cwd).find((item) => item.name === "legacy-flags");
    assert.equal(loaded.loadSkills, false);
    assert.equal(loaded.loadExtensions, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
