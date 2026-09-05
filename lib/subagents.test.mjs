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
  listSubagentProfileSources,
  listSubagentProfiles,
  readSubagentRun,
  readSubagentSessionResources,
  resolveSubagentProfile,
  saveSubagentProfile,
  saveProjectSubagentProfile,
  SUBAGENT_META_TYPE,
  SUBAGENT_RESULT_TYPE,
  withSubagentExtensionTools,
} = await createJiti(import.meta.url).import("./subagents.ts");
const { isSubagentProfileOverridden } = await createJiti(import.meta.url).import("./subagent-profile-precedence.ts");

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

test("legacy extension selectors are omitted from lightweight profile tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagents-"));
  try {
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "agents", "legacy.md"),
      "---\ndescription: Legacy\ntools: read, ext:mcp/search, write\ndisallowed_tools: write\n---\nInspect only.\n",
    );
    const profile = listSubagentProfiles(cwd).find((item) => item.name === "legacy");
    assert.deepEqual(profile.tools, ["read"]);
    assert.equal(profile.loadSkills, false);
    assert.equal(profile.loadExtensions, false);
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
