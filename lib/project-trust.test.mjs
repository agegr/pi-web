import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  getProjectTrustStatus,
  hasTrustRequiringProjectResources,
  isInsideProject,
  trustProject,
  untrustedProjectSessionOptions,
} = await createJiti(import.meta.url).import("./project-trust.ts");

async function createProjectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "omp-web-project-trust-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir };
}

test("clean projects stay on the normal trusted load path", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);

  assert.equal(hasTrustRequiringProjectResources(cwd), false);
  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: false,
    trusted: true,
  });
  assert.equal(
    untrustedProjectSessionOptions(cwd, agentDir, { extensionPaths: [], customToolPaths: [] }),
    undefined,
  );
});

test("code-bearing project directories require an explicit trust decision", async (t) => {
  for (const dir of [".omp/extensions", ".omp/hooks", ".omp/tools", ".claude/tools", ".agents/hooks"]) {
    const { cwd, agentDir } = await createProjectFixture(t);
    await mkdir(join(cwd, dir), { recursive: true });

    assert.equal(hasTrustRequiringProjectResources(cwd), true, dir);
    assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: true, trusted: false }, dir);
  }
});

test("an MCP manifest requires trust because omp would spawn its servers", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await writeFile(join(cwd, ".mcp.json"), "{}");

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: true, trusted: false });
});

test("skills and rules alone never require trust", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".omp", "skills", "demo"), { recursive: true });
  await writeFile(join(cwd, ".omp", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: false, trusted: true });
});

test("an untrusted project drops only its own extensions, tools, and MCP servers", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".omp", "extensions"), { recursive: true });

  const projectExtension = join(cwd, ".omp", "extensions", "probe.ts");
  const userExtension = join(agentDir, "extensions", "user.ts");
  const projectTool = { path: join(cwd, ".omp", "tools", "probe.ts"), source: { level: "project" } };
  const userTool = { path: join(agentDir, "tools", "user.ts"), source: { level: "user" } };

  const gated = untrustedProjectSessionOptions(cwd, agentDir, {
    extensionPaths: [projectExtension, userExtension],
    customToolPaths: [projectTool, userTool],
  });

  assert.deepEqual(gated.preloadedExtensionPaths, [userExtension]);
  assert.deepEqual(gated.preloadedCustomToolPaths, [userTool]);
  assert.equal(gated.enableMCP, false);
});

test("trusting a project persists the decision and restores the normal load path", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".omp", "extensions"), { recursive: true });
  const projectExtension = join(cwd, ".omp", "extensions", "probe.ts");

  assert.deepEqual(trustProject(cwd, agentDir), { requiresTrust: true, trusted: true });
  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: true, trusted: true });
  assert.equal(
    untrustedProjectSessionOptions(cwd, agentDir, {
      extensionPaths: [projectExtension],
      customToolPaths: [],
    }),
    undefined,
  );

  const stored = JSON.parse(await readFile(join(agentDir, "omp-web-trusted-projects.json"), "utf8"));
  assert.equal(Object.values(stored)[0], true);
});

test("isInsideProject does not treat sibling directories as project-local", () => {
  assert.equal(isInsideProject("/repo/.omp/extensions/a.ts", "/repo"), true);
  assert.equal(isInsideProject("/repo", "/repo"), true);
  assert.equal(isInsideProject("/repo-worktrees/other/a.ts", "/repo"), false);
  assert.equal(isInsideProject("/home/user/.omp/agent/extensions/a.ts", "/repo"), false);
});

test("every project-resource entry point enforces project trust", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const skillsSource = await readFile(new URL("./skills-service.ts", import.meta.url), "utf8");
  const skillsInstallSource = await readFile(new URL("../app/api/skills/install/route.ts", import.meta.url), "utf8");

  assert.match(rpcSource, /untrustedProjectSessionOptions\(sessionCwd, agentDir, \{ extensionPaths, customToolPaths \}\)/);
  assert.match(skillsSource, /getProjectTrustStatus\(cwd, agentDir\)\.trusted/);
  assert.match(skillsInstallSource, /getProjectTrustStatus\(cwd, getAgentDir\(\)\)\.trusted/);
});

test("the trust API invalidates cached models and restricted runtimes", async () => {
  const source = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /trustProject\(result\.cwd, agentDir\)/);
  assert.match(source, /invalidateModelsCache\(\)/);
  assert.match(source, /destroyRpcSessionsForCwd\(result\.cwd\)/);
  assert.match(source, /hasBusyRpcSessionForCwd\(result\.cwd\)/);
  assert.match(rpcSource, /trackStartingSession\(sessionCwd\)/);
  assert.match(rpcSource, /realpathSync\(resolvedCwd\)/);
});
