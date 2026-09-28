import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-catalog-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const { listAgentCatalog, findConfiguredProjectRoot } = await createJiti(import.meta.url).import("./pi-subagents-catalog.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
  await rm(join(testAgentDir, "settings.json"), { force: true });
  await rm(join(testAgentDir, "npm"), { recursive: true, force: true });
});

async function tmpCwd() {
  return mkdtemp(join(tmpdir(), "pi-web-catalog-"));
}

async function writeAgent(dir, name, frontmatter, body = "Prompt.\n") {
  await mkdir(dir, { recursive: true });
  // pi-subagents skips a definition without both `name` and `description`.
  const fields = { name, ...frontmatter };
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  await writeFile(join(dir, `${name}.md`), `---\n${lines.join("\n")}\n---\n${body}`);
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** A configured `npm:pi-subagents` install, like pi writes into the agent dir. */
async function installFakePiSubagents(agents) {
  const root = join(testAgentDir, "npm", "node_modules", "pi-subagents");
  await writeJson(join(root, "package.json"), { name: "pi-subagents", version: "0.0.0" });
  for (const [name, fields] of Object.entries(agents)) {
    await writeAgent(join(root, "agents"), name, fields);
  }
  await writeJson(join(testAgentDir, "settings.json"), { packages: ["npm:pi-subagents"] });
}

/** The winning row for a name: the source with the highest precedence. */
function winner(agents, name) {
  const ranks = { builtin: 0, package: 1, user: 2, project: 3 };
  return agents
    .filter((agent) => agent.name === name)
    .sort((a, b) => ranks[a.source] - ranks[b.source])
    .at(-1);
}

test("discovers user and project agents with their frontmatter fields", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "planner", { description: "Global planner" });
  await writeAgent(join(cwd, ".pi", "agents"), "scout", {
    description: "Project scout",
    tools: "read, grep",
    thinking: "low",
    aliases: "lookout",
    advertise: "true",
    model: "litellm/scout-model",
  });

  const agents = listAgentCatalog(cwd);
  const scout = agents.find((agent) => agent.name === "scout");
  assert.equal(scout.source, "project");
  assert.deepEqual(scout.tools, ["read", "grep"]);
  assert.equal(scout.thinking, "low");
  assert.deepEqual(scout.aliases, ["lookout"]);
  assert.equal(scout.advertise, true);
  assert.equal(scout.model, "litellm/scout-model");
  assert.equal(agents.find((agent) => agent.name === "planner").source, "user");
});

test("extracts the trimmed markdown body as the prompt", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "scout", { description: "Scout" }, "\n  Recon the codebase.\n  Return compressed context.\n\n");

  const scout = listAgentCatalog(cwd).find((agent) => agent.name === "scout");
  assert.equal(scout.prompt, "Recon the codebase.\n  Return compressed context.");
});

test("leaves the prompt unset when the file has no body", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "empty", { description: "Empty body" }, "");
  await writeAgent(join(testAgentDir, "agents"), "blank", { description: "Blank body" }, "\n\n  \n");

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "empty").prompt, undefined);
  assert.equal(agents.find((agent) => agent.name === "blank").prompt, undefined);
});

test("does not confuse frontmatter edge cases with the prompt body", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const dir = join(testAgentDir, "agents");
  await mkdir(dir, { recursive: true });
  // A body containing a horizontal rule must not be mistaken for a delimiter,
  // and CRLF frontmatter must still yield the body after the closing fence.
  await writeFile(join(dir, "hr.md"), "---\nname: hr\ndescription: Has an hr\n---\nFirst line.\n---\nStill prompt.\n");
  await writeFile(join(dir, "crlf.md"), "---\r\nname: crlf\r\ndescription: CRLF\r\n---\r\nBody after CRLF.\r\n");

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "hr").prompt, "First line.\n---\nStill prompt.");
  assert.equal(agents.find((agent) => agent.name === "crlf").prompt, "Body after CRLF.");
});

test("reads the legacy .agents dir and the preferred .pi/agents dir of a project", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(cwd, ".agents"), "legacy", { description: "Legacy project agent" });
  await writeAgent(join(cwd, ".pi", "agents"), "modern", { description: "Modern project agent" });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "legacy").source, "project");
  assert.equal(agents.find((agent) => agent.name === "modern").source, "project");
});

test("a session in a subdirectory sees the nearest project root's agents", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const nested = join(cwd, "packages", "app");
  await mkdir(nested, { recursive: true });
  await writeAgent(join(cwd, ".pi", "agents"), "rooted", { description: "Root agent" });

  assert.equal(findConfiguredProjectRoot(nested), cwd);
  assert.equal(listAgentCatalog(nested).find((agent) => agent.name === "rooted").source, "project");
});

test("lists the pi-subagents built-ins from its installed package", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({
    oracle: { aliases: "advisor", description: "Decision oracle", thinking: "high" },
  });

  const oracle = listAgentCatalog(cwd).find((agent) => agent.name === "oracle");
  assert.equal(oracle.source, "builtin");
  assert.deepEqual(oracle.aliases, ["advisor"]);
});

test("marks same-name entries from lower-precedence sources as overridden", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ worker: { description: "Built-in worker" } });
  await writeAgent(join(testAgentDir, "agents"), "worker", { description: "User worker" });
  await writeAgent(join(cwd, ".pi", "agents"), "worker", { description: "Project worker" });

  const agents = listAgentCatalog(cwd);
  const rows = agents.filter((agent) => agent.name === "worker");
  assert.deepEqual(rows.map((agent) => agent.source), ["builtin", "user", "project"]);
  assert.deepEqual(rows.map((agent) => agent.overriddenBy), ["project", "project", undefined]);
  assert.equal(winner(agents, "worker").description, "Project worker");
});

test("applies agentOverrides, the default model, and default thinking", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "reviewer", { description: "User reviewer" });
  await writeJson(join(testAgentDir, "settings.json"), {
    subagents: {
      defaultModel: "provider/default-model",
      defaultThinking: "medium",
      agentOverrides: {
        reviewer: { description: "Tuned reviewer", thinking: "high", tools: ["read"], disabled: true },
      },
    },
  });

  const reviewer = listAgentCatalog(cwd).find((agent) => agent.name === "reviewer");
  assert.equal(reviewer.description, "Tuned reviewer");
  assert.deepEqual(reviewer.tools, ["read"]);
  assert.equal(reviewer.thinking, "high");
  assert.equal(reviewer.disabled, true);
  assert.deepEqual(reviewer.disabledSource, { scope: "user", via: "override" });
  assert.equal(reviewer.model, "provider/default-model");
});

test("the project settings file wins over the user file for the same override", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "reviewer", { description: "User reviewer" });
  await writeJson(join(testAgentDir, "settings.json"), {
    subagents: { agentOverrides: { reviewer: { description: "From user settings" } } },
  });
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { agentOverrides: { reviewer: { description: "From project settings" } } },
  });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "reviewer").description, "From project settings");
});

test("disableBuiltins marks built-in rows disabled without hiding them", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" } });
  await writeJson(join(cwd, ".pi", "settings.json"), { subagents: { disableBuiltins: true } });
  await writeAgent(join(cwd, ".pi", "agents"), "mine", { description: "My agent" });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "oracle").disabled, true);
  assert.deepEqual(agents.find((agent) => agent.name === "oracle").disabledSource, { scope: "project", via: "bulk" });
  assert.equal(agents.find((agent) => agent.name === "mine").disabled, undefined);
  assert.equal(agents.find((agent) => agent.name === "mine").disabledSource, undefined);
});

test("a user-scope override records its own scope, and a project override records project", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" }, worker: { description: "Worker" } });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { agentOverrides: { oracle: { disabled: true } } },
  });
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { agentOverrides: { worker: { disabled: true } } },
  });

  const agents = listAgentCatalog(cwd);
  assert.deepEqual(agents.find((agent) => agent.name === "oracle").disabledSource, { scope: "user", via: "override" });
  assert.deepEqual(agents.find((agent) => agent.name === "worker").disabledSource, { scope: "project", via: "override" });
});

test("a shadowed row exposes the winner's disable state and provenance, not its own", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" } });
  // The builtin is bulk-disabled; a project file shadows it but is itself enabled.
  await writeJson(join(cwd, ".pi", "settings.json"), { subagents: { disableBuiltins: true } });
  await writeAgent(join(cwd, ".pi", "agents"), "oracle", { description: "Project oracle" });

  const rows = listAgentCatalog(cwd).filter((agent) => agent.name === "oracle");
  const builtin = rows.find((agent) => agent.source === "builtin");
  const project = rows.find((agent) => agent.source === "project");
  // The custom row is not bulk-disabled; the builtin row is, and it is shadowed.
  assert.equal(project.disabled, undefined);
  assert.equal(project.disabledSource, undefined);
  assert.equal(builtin.overriddenBy, "project");
  assert.equal(builtin.disabled, undefined);
  assert.equal(builtin.disabledSource, undefined);

  // Flip it: the project row wins and is disabled by its project override, so
  // the display-only builtin row must report the winner's reason.
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { agentOverrides: { oracle: { disabled: true } } },
  });
  const nextRows = listAgentCatalog(cwd).filter((agent) => agent.name === "oracle");
  const nextBuiltin = nextRows.find((agent) => agent.source === "builtin");
  const nextProject = nextRows.find((agent) => agent.source === "project");
  assert.deepEqual(nextProject.disabledSource, { scope: "project", via: "override" });
  assert.equal(nextBuiltin.overriddenBy, "project");
  assert.equal(nextBuiltin.disabled, true);
  assert.deepEqual(nextBuiltin.disabledSource, { scope: "project", via: "override" });
});

test("reads extra agent scan dirs from settings", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const extra = join(cwd, "team-agents");
  await writeAgent(extra, "teamie", { description: "Team agent" });
  await writeJson(join(testAgentDir, "settings.json"), { subagents: { agentScanDirs: [extra] } });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "teamie").source, "user");
});

test("skips definitions pi-subagents cannot dispatch: no name, no description, or no frontmatter", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const dir = join(cwd, ".pi", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "bare.md"), "---\ndescription: No name key\ntools: read\n---\nBody\n");
  await writeFile(join(dir, "unnamed.md"), "---\nname: unnamed\n---\nBody\n");
  await writeFile(join(dir, "plain.md"), "No frontmatter at all.\n");
  await writeFile(join(dir, "notes.txt"), "not markdown\n");

  assert.equal(listAgentCatalog(cwd).some((agent) => agent.source === "project"), false);
});

test("package agents are first-wins across packages; user agents are last-wins across dirs", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // pi-subagents dedupes package agents with a first-wins map, so the first
  // configured package wins a name collision between two packages. A bare local
  // source resolves against the agent dir for user-scope packages.
  const [first, second] = [join(testAgentDir, "pkg-a"), join(testAgentDir, "pkg-b")];
  await writeAgent(join(first, "agents"), "shared", { description: "From package A" });
  await writeAgent(join(second, "agents"), "shared", { description: "From package B" });
  await writeJson(join(first, "package.json"), { name: "pkg-a", pi: { subagents: { agents: ["agents"] } } });
  await writeJson(join(second, "package.json"), { name: "pkg-b", pi: { subagents: { agents: ["agents"] } } });
  await writeJson(join(testAgentDir, "settings.json"), { packages: ["pkg-a", "pkg-b"] });

  const shared = listAgentCatalog(cwd).filter((agent) => agent.name === "shared");
  assert.deepEqual(shared.map((agent) => agent.source), ["package", "package"]);
  assert.equal(shared.at(-1).description, "From package A");
  assert.equal(shared[0].overriddenBy, "package");

  // A user agent name in two user dirs: the later directory (the ~/.agents
  // equivalent) wins, matching pi-subagents' last-wins merge for custom agents.
  const extra = join(cwd, "extra-agents");
  await writeAgent(extra, "dupe", { description: "From the scan dir" });
  await writeAgent(join(testAgentDir, "agents"), "dupe", { description: "From the agent dir" });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["pkg-a", "pkg-b"],
    subagents: { agentScanDirs: [extra] },
  });

  const dupe = listAgentCatalog(cwd).filter((agent) => agent.name === "dupe");
  assert.deepEqual(dupe.map((agent) => agent.source), ["user", "user"]);
  assert.equal(dupe.at(-1).description, "From the agent dir");
});

test("applies defaults before overrides so `model: false` cannot be resurrected", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle", model: "prov/builtin-model" } });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { defaultModel: "prov/default-model", agentOverrides: { oracle: { model: false } } },
  });

  const oracle = listAgentCatalog(cwd).find((agent) => agent.name === "oracle");
  assert.equal(oracle.model, undefined);
});

test("an override entry with only unrecognized fields does not shield a builtin", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ worker: { description: "Built-in worker" } });
  // pi-subagents drops an entry holding no recognized field entirely, so it
  // neither overrides nor shields the builtin from the bulk disable.
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableBuiltins: true, agentOverrides: { worker: { bogusField: true } } },
  });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "worker").disabled, true);
});

test("disableThinking strips builtin thinking unless the applied override sets it", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({
    oracle: { description: "Decision oracle", thinking: "high" },
    worker: { description: "Built-in worker", thinking: "low" },
  });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableThinking: true, agentOverrides: { worker: { thinking: "medium" } } },
  });

  const agents = listAgentCatalog(cwd);
  // No override: the builtin's thinking is cleared.
  assert.equal(agents.find((agent) => agent.name === "oracle").thinking, undefined);
  // A user override that sets thinking survives the user-wide disable.
  assert.equal(agents.find((agent) => agent.name === "worker").thinking, "medium");
});

test("a project disableThinking value suppresses the user value", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({
    oracle: { description: "Decision oracle", thinking: "high" },
    researcher: { description: "Researcher", thinking: "medium" },
  });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableThinking: true },
  });
  // A project value (true or false) is the effective one; here `false` restores
  // the builtin thinking that the user-wide `true` would have cleared.
  await writeJson(join(cwd, ".pi", "settings.json"), { subagents: { disableThinking: false } });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "oracle").thinking, "high");

  // A project-level `true` clears a user override that sets thinking, because
  // the project scope owns the disable value.
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { disableThinking: true, agentOverrides: {} },
  });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableThinking: true, agentOverrides: { researcher: { thinking: "high" } } },
  });
  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "researcher").thinking, undefined);
});

test("a pi-subagents install configured at both scopes yields one builtin copy", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" } });
  // A second, project-scope copy of the same package must not duplicate rows.
  const projectRoot = join(cwd, ".pi", "npm", "node_modules", "pi-subagents");
  await writeJson(join(projectRoot, "package.json"), { name: "pi-subagents", version: "0.0.0-proj" });
  await writeAgent(join(projectRoot, "agents"), "oracle", { description: "Decision oracle" });
  await writeJson(join(cwd, ".pi", "settings.json"), { packages: ["npm:pi-subagents"] });

  const builtinRows = listAgentCatalog(cwd).filter((agent) => agent.source === "builtin");
  assert.equal(builtinRows.length, 1);
});

test("an override shields a builtin from the bulk disable at its own scope", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" }, worker: { description: "Worker" } });
  // A user override wins over the user-wide bulk disable; builtins without one
  // are still disabled.
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableBuiltins: true, agentOverrides: { oracle: { description: "Shielded" } } },
  });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "oracle").disabled, undefined);
  assert.equal(agents.find((agent) => agent.name === "worker").disabled, true);
});

test("a project override shields a builtin from the user bulk disable", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" }, worker: { description: "Worker" } });
  await writeJson(join(testAgentDir, "settings.json"), {
    packages: ["npm:pi-subagents"],
    subagents: { disableBuiltins: true },
  });
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { agentOverrides: { worker: { description: "Project shielded" } } },
  });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "worker").disabled, undefined);
  assert.equal(agents.find((agent) => agent.name === "oracle").disabled, true);
});

test("an explicit `thinking: false` survives the default-thinking fill-in as off", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(testAgentDir, "agents"), "myagent", { description: "Mine", thinking: "false" });
  await writeJson(join(testAgentDir, "settings.json"), { subagents: { defaultThinking: "medium" } });

  const myagent = listAgentCatalog(cwd).find((agent) => agent.name === "myagent");
  assert.equal(myagent.thinking, "off");
});

test("prunes a nested `.git` directory while walking an agent dir", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const vendored = join(cwd, ".pi", "agents", "vendored");
  await writeAgent(vendored, "vendored-agent", { description: "Vendored" });
  await writeAgent(join(vendored, "sub"), "inner-agent", { description: "Inner" });
  await mkdir(join(vendored, ".git"), { recursive: true });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.some((agent) => agent.name === "vendored-agent"), false);
  assert.equal(agents.some((agent) => agent.name === "inner-agent"), false);
});

test("treats the project root's own package as a package source", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeAgent(join(cwd, "agents"), "rootpkg", { description: "Root package agent" });
  await writeJson(join(cwd, "package.json"), { name: "my-project", "pi-subagents": { agents: ["agents"] } });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "rootpkg").source, "package");
});

test("reads unconfigured packages from the agent dir's node_modules", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // A package present on disk without a settings entry is still discovered by
  // pi-subagents' node_modules scan.
  const ghost = join(testAgentDir, "npm", "node_modules", "ghost-pkg");
  await writeAgent(join(ghost, "agents"), "ghosty", { description: "Ghost agent" });
  await writeJson(join(ghost, "package.json"), { name: "ghost-pkg", pi: { subagents: { agents: ["agents"] } } });

  assert.equal(listAgentCatalog(cwd).find((agent) => agent.name === "ghosty").source, "package");
});

test("project-scope packages win a same-name collision against user-scope ones", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const userPkg = join(testAgentDir, "npm", "node_modules", "upkg");
  await writeAgent(join(userPkg, "agents"), "shared", { description: "From user package" });
  await writeJson(join(userPkg, "package.json"), { name: "upkg", pi: { subagents: { agents: ["agents"] } } });
  const projectPkg = join(cwd, ".pi", "npm", "node_modules", "ppkg");
  await writeAgent(join(projectPkg, "agents"), "shared", { description: "From project package" });
  await writeJson(join(projectPkg, "package.json"), { name: "ppkg", pi: { subagents: { agents: ["agents"] } } });

  const rows = listAgentCatalog(cwd).filter((agent) => agent.name === "shared");
  assert.equal(winner(rows, "shared").description, "From project package");
  // pi-subagents' package map is first-wins, so the project row must not be the
  // one marked overridden.
  const projectRow = rows.find((agent) => agent.filePath.startsWith(projectPkg));
  assert.equal(projectRow.overriddenBy, undefined);
});

test("folds `package:` frontmatter into the runtime name so it cannot shadow a builtin", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" } });
  await writeAgent(join(cwd, ".pi", "agents"), "oracle", { description: "Packed oracle", package: "team" });

  const agents = listAgentCatalog(cwd);
  assert.ok(agents.some((agent) => agent.name === "team.oracle"));
  // The builtin oracle keeps its own row with no `overriddenBy`.
  const builtin = agents.find((agent) => agent.name === "oracle" && agent.source === "builtin");
  assert.equal(builtin.overriddenBy, undefined);
});

test("reads project-scope agent scan dirs and keeps them out of the bulk disable", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await installFakePiSubagents({ oracle: { description: "Decision oracle" } });
  const extra = join(cwd, "team-agents");
  await writeAgent(extra, "teamie", { description: "Team agent" });
  await writeJson(join(cwd, ".pi", "settings.json"), {
    subagents: { agentScanDirs: ["../team-agents"], disableBuiltins: true },
  });

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.find((agent) => agent.name === "teamie").source, "project");
  assert.equal(agents.find((agent) => agent.name === "teamie").disabled, undefined);
  assert.equal(agents.find((agent) => agent.name === "oracle").disabled, true);
});

test("never throws on missing directories, malformed files, or malformed settings", async (t) => {
  const cwd = await tmpCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const dir = join(cwd, ".pi", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "broken.md"), "---\nname: [unterminated\n---\nbody\n");
  await writeFile(join(dir, "broken2.md"), "---\nname: broken2\ndescription: ok\n---\nbody\n");
  await writeFile(join(cwd, ".pi", "settings.json"), "{ not json");
  await writeFile(join(testAgentDir, "settings.json"), "{ not json either");

  const agents = listAgentCatalog(cwd);
  assert.equal(agents.some((agent) => agent.name === "broken"), false);
  assert.equal(agents.find((agent) => agent.name === "broken2").source, "project");
  // An empty directory with no project ancestor is just an empty catalog.
  const bare = await tmpCwd();
  t.after(() => rm(bare, { recursive: true, force: true }));
  assert.deepEqual(listAgentCatalog(bare), []);
});
