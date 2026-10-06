import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  findInheritingTrustProject,
  freshFolderTrustBreadth,
  getProjectTrustStatus,
  hasTrustRelevantEntries,
  mayReadProjectConfigNow,
  NESTED_PROJECT_SCAN_MAX_FOLDERS,
  projectTrustReloadOptions,
  TRUST_REQUIRING_PROJECT_ENTRIES,
  trustFreshFolderAndWrite,
  trustProject,
} = await jiti.import("./project-trust.ts");

async function createProjectFixture(t) {
  // Real paths: trust.json keys folders by them, and the temp folder is a link on macOS.
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-project-trust-")));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir };
}

test("clean projects stay on the normal trusted load path", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: false,
    trusted: true,
    decision: null,
    inherited: false,
  });
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined);
});

test("additional explicit project resources use the same exact/inherited trust decisions without changing clean-folder defaults", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  const status = () => getProjectTrustStatus(cwd, agentDir, { additionalProjectResources: true });
  assert.equal(status().requiresTrust, true); assert.equal(status().trusted, false);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  store.set(root, true);
  assert.equal(status().trusted, true); assert.equal(status().inherited, true);
  store.set(cwd, false);
  assert.equal(status().trusted, false); assert.equal(status().decision, false); assert.equal(status().inherited, false);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true, "normal clean-folder behavior is unchanged even with an explicit false");
  store.set(cwd, true);
  assert.equal(status().trusted, true); assert.equal(status().decisionPath, cwd);
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined);
});

test("additional project resources fail closed on unreadable trust while clean-folder status remains compatible", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await writeFile(join(agentDir, "trust.json"), "{");
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  assert.ok(getProjectTrustStatus(cwd, agentDir).decisionError);
  assert.throws(() => getProjectTrustStatus(cwd, agentDir, { additionalProjectResources: true }));
});

test("project extensions execute only after the project is trusted", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const extensionDir = join(cwd, ".pi", "extensions");
  const marker = join(root, "extension-executed");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(extensionDir, "probe.js"),
    `import { writeFileSync } from "node:fs";\nexport default () => { writeFileSync(${JSON.stringify(marker)}, "executed"); };\n`,
  );

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: true,
    trusted: false,
    decision: null,
    inherited: false,
  });

  const restrictedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await restrictedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), false);
  assert.equal(restrictedLoader.getExtensions().extensions.length, 0);

  assert.deepEqual(trustProject(cwd, agentDir), {
    requiresTrust: true,
    trusted: true,
    decision: true,
    decisionPath: cwd,
    inherited: false,
  });

  const trustedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await trustedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), true);
  assert.equal(trustedLoader.getExtensions().extensions.length, 1);
});

test("trusting reports the decision it wrote, so a failed read afterwards cannot fail it", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
  const link = join(root, "linked-project");
  await symlink(cwd, link);

  // Every read after the one that checks the folder fails, as a lock held
  // past the store's wait would; the write itself still succeeds.
  const getEntry = ProjectTrustStore.prototype.getEntry;
  let reads = 0;
  ProjectTrustStore.prototype.getEntry = function (...args) {
    reads += 1;
    if (reads > 1) throw new Error("Lock file is already being held");
    return getEntry.apply(this, args);
  };
  t.after(() => {
    ProjectTrustStore.prototype.getEntry = getEntry;
  });
  assert.deepEqual(
    trustProject(link, agentDir),
    { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false },
    "keyed by the real path, as the store writes it",
  );
  assert.equal(reads, 1, "the status was read once, before the write");
  ProjectTrustStore.prototype.getEntry = getEntry;
  assert.equal(new ProjectTrustStore(agentDir).get(cwd), true);
});

test("the reload resolver reads the latest persisted trust decision", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });

  const reloadOptions = projectTrustReloadOptions(cwd, agentDir);
  assert.ok(reloadOptions);
  assert.equal(await reloadOptions.resolveProjectTrust(), false);

  trustProject(cwd, agentDir);
  assert.equal(await reloadOptions.resolveProjectTrust(), true);
});

test("the status tells exact, inherited, refused and missing decisions apart", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
  const status = () => getProjectTrustStatus(cwd, agentDir);

  assert.deepEqual(status(), { requiresTrust: true, trusted: false, decision: null, inherited: false });
  store.set(cwd, true);
  assert.deepEqual(status(), { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false });
  store.set(cwd, false);
  assert.deepEqual(status(), { requiresTrust: true, trusted: false, decision: false, decisionPath: cwd, inherited: false });
  store.set(cwd, null);
  store.set(root, true);
  assert.deepEqual(status(), { requiresTrust: true, trusted: true, decision: true, decisionPath: root, inherited: true });
  store.set(root, false);
  assert.deepEqual(status(), { requiresTrust: true, trusted: false, decision: false, decisionPath: root, inherited: true });
  store.set(root, true);
  store.set(cwd, false);
  assert.deepEqual(
    status(),
    { requiresTrust: true, trusted: false, decision: false, decisionPath: cwd, inherited: false },
    "an exact false beneath a trusted parent",
  );
});

test("a folder that requires no trust still reports the decision it would inherit", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  store.set(root, true);
  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: false,
    trusted: true,
    decision: true,
    decisionPath: root,
    inherited: true,
  });
  store.set(root, false);
  assert.equal(getProjectTrustStatus(cwd, agentDir).decision, false, "trusted stays true: nothing needs trust yet");
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
});

test("a folder opened through a link is trusted exactly, as trust.json keys it by its real path", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  const link = join(root, "linked-project");
  await symlink(cwd, link);
  new ProjectTrustStore(agentDir).set(link, true);
  assert.deepEqual(getProjectTrustStatus(link, agentDir), {
    requiresTrust: true,
    trusted: true,
    decision: true,
    decisionPath: cwd,
    inherited: false,
  });
});

test("an unreadable trust store does not fail a folder that requires no trust", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await writeFile(join(agentDir, "trust.json"), "{ not json");
  const status = getProjectTrustStatus(cwd, agentDir);
  assert.equal(status.requiresTrust, false);
  assert.equal(status.trusted, true);
  assert.equal(status.decision, null);
  assert.match(status.decisionError, /trust\.json/);
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined, "session start never reads the store for it");
});

test("the fresh trust read follows the folder's resources and every decision as it changes", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true, "a folder without project resources needs no trust");
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false, "but has no project file to read, so none is read");
  store.set(root, true);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false, "not even under a trusted parent");
  store.set(root, null);

  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false, "no decision yet");
  store.set(cwd, true);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), true);
  store.set(cwd, false);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
  store.set(cwd, null);
  store.set(root, true);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), true, "inherited from a trusted parent");
  store.set(cwd, false);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false, "an exact false beneath a trusted parent");
});

test("an unparsable trust store counts as untrusted, with one warning per error", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  new ProjectTrustStore(agentDir).set(cwd, true);
  await writeFile(join(agentDir, "trust.json"), "{ not json");
  const warn = t.mock.method(console, "warn", () => {});

  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /cannot read project trust.*trust\.json/);
  assert.throws(() => getProjectTrustStatus(cwd, agentDir), /trust\.json/, "the status itself still reports the failure");
});

test("a trust store still locked by another process counts as untrusted, with one warning naming it", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  new ProjectTrustStore(agentDir).set(cwd, true);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), true);
  // proper-lockfile's lock is a directory beside the file; a fresh one is never stale.
  await mkdir(join(agentDir, "trust.json.lock"));
  const warn = t.mock.method(console, "warn", () => {});

  const started = Date.now();
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
  // The store retries synchronously before it gives up; this is what each locked read costs.
  assert.ok(Date.now() - started >= 150, `gave up after ${Date.now() - started} ms`);
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
  assert.equal(warn.mock.callCount(), 1);
  // The lock error itself does not name the file.
  assert.ok(String(warn.mock.calls[0].arguments[0]).includes(join(agentDir, "trust.json")));

  await rm(join(agentDir, "trust.json.lock"), { recursive: true });
  assert.equal(mayReadProjectConfigNow(cwd, agentDir), true, "trusted again once the lock is gone");
});

test("all project resource loaders and reloads enforce project trust", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const modelsSource = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  const skillsSource = await readFile(new URL("./skills-service.ts", import.meta.url), "utf8");
  const skillsInstallSource = await readFile(new URL("../app/api/skills/install/route.ts", import.meta.url), "utf8");
  const pluginsSource = await readFile(new URL("../app/api/plugins/route.ts", import.meta.url), "utf8");

  assert.match(rpcSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(rpcSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(rpcSource, /resourceLoaderReloadOptions: trustReloadOptions/);
  assert.equal(
    Array.from(rpcSource.matchAll(/this\.syncProjectTrust\(\);\s*await this\.inner\.reload/g)).length,
    2,
  );

  assert.match(modelsSource, /projectTrustReloadOptions\(cwd, agentDir\)/);
  assert.match(modelsSource, /resourceLoaderReloadOptions: trustReloadOptions/);
  assert.match(skillsSource, /loader\.reload\(projectTrustReloadOptions\(cwd, agentDir\)\)/);
  assert.match(pluginsSource, /projectTrusted: projectTrust\.trusted/);
  assert.match(
    skillsInstallSource,
    /getProjectTrustStatus\(cwd, getAgentDir\(\)\)\.trusted/,
  );
  assert.equal(
    Array.from(pluginsSource.matchAll(/projectTrusted: projectTrust\.trusted/g)).length,
    2,
  );
  assert.match(pluginsSource, /scope === "project" && !projectTrust\.trusted/);
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

// ---------------------------------------------------------------------------
// Trusting a fresh folder in the same step as writing to it

const trustJson = (agentDir) => {
  const path = join(agentDir, "trust.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};

test("the fresh check looks for exactly what makes the SDK require trust", async (t) => {
  // The SDK keeps the list module-private; an upgrade that adds an entry must fail here.
  const sdkDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const source = readFileSync(join(sdkDist, "core", "trust-manager.js"), "utf8");
  const listed = source.match(/TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = \[([\s\S]*?)\]/)?.[1];
  assert.ok(listed, "the SDK still defines the list");
  assert.deepEqual([...listed.matchAll(/"([^"]+)"/g)].map((match) => match[1]), [...TRUST_REQUIRING_PROJECT_ENTRIES]);

  const { cwd } = await createProjectFixture(t);
  for (const entry of TRUST_REQUIRING_PROJECT_ENTRIES) {
    const path = join(cwd, ".pi", entry);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(path, "");
    assert.equal(hasTrustRequiringProjectResources(cwd), true, entry);
    assert.equal(hasTrustRelevantEntries(cwd), true, entry);
    await rm(path);
  }
  assert.equal(hasTrustRelevantEntries(cwd), false, "an empty .pi needs no trust");
});

test("the fresh check also counts links to nothing, which existsSync skips", async (t) => {
  const { root, cwd } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await symlink(join(root, "not-yet"), join(cwd, ".pi", "extensions"));
  assert.equal(hasTrustRequiringProjectResources(cwd), false, "the SDK does not see it yet");
  assert.equal(hasTrustRelevantEntries(cwd), true, "but it counts the moment its target appears");
  await rm(join(cwd, ".pi"), { recursive: true });

  await symlink(join(root, "nowhere"), join(cwd, ".pi"));
  assert.equal(hasTrustRelevantEntries(cwd), true, "a .pi that is a link to nothing");
  await rm(join(cwd, ".pi"));

  // .agents/skills in an ancestor makes the SDK require trust too; the home folder's own does not.
  await mkdir(join(root, ".agents", "skills"), { recursive: true });
  assert.equal(hasTrustRelevantEntries(cwd), true);
  assert.equal(hasTrustRelevantEntries(cwd, root), false, "the user's own ~/.agents/skills");
});

test("a fresh folder is trusted first, then written, as one step", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  let trustedWhenWriting;
  const result = await trustFreshFolderAndWrite(cwd, agentDir, async () => {
    trustedWhenWriting = store.get(cwd);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
    return "written";
  }, { knownFolders: [cwd] });

  assert.equal(trustedWhenWriting, true, "the decision is on disk before the write");
  assert.deepEqual(result, {
    ok: true,
    value: "written",
    status: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false },
  });
  assert.deepEqual(trustJson(agentDir), { [cwd]: true }, "an exact decision for the folder, as trustProject() writes");
  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), result.status);
});

test("a write that fails takes the trust back, and says so when it cannot", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  const failure = new Error("disk full");
  const result = await trustFreshFolderAndWrite(cwd, agentDir, () => {
    throw failure;
  }, { knownFolders: [] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "write-failed");
  assert.equal(result.writeError, failure);
  assert.equal(result.rollbackError, undefined);
  assert.deepEqual(trustJson(agentDir), {}, "the key it wrote is gone again");
  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: false, trusted: true, decision: null, inherited: false });

  // The store cannot be written after the trust: the folder stays trusted, and the result says so.
  const warn = t.mock.method(console, "warn", () => {});
  const lock = join(agentDir, "trust.json.lock");
  const stuck = await trustFreshFolderAndWrite(cwd, agentDir, async () => {
    await mkdir(lock);
    throw failure;
  }, { knownFolders: [] });
  await rm(lock, { recursive: true });
  assert.equal(stuck.reason, "write-failed");
  assert.match(stuck.rollbackError, /lock/i);
  assert.equal(stuck.status.trusted, true);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(trustJson(agentDir), { [cwd]: true });
});

test("a folder that changed under the step is refused unwritten and untrusted", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const store = new ProjectTrustStore(agentDir);
  let writes = 0;
  const write = () => {
    writes += 1;
  };

  // A git pull brought project extensions since the panel offered the step.
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  let result = await trustFreshFolderAndWrite(cwd, agentDir, write, { knownFolders: [] });
  assert.equal(result.reason, "folder-not-fresh");
  assert.deepEqual(result.status, { requiresTrust: true, trusted: false, decision: null, inherited: false });
  await rm(join(cwd, ".pi"), { recursive: true });

  // A link to nothing that would count once its target appears.
  await mkdir(join(cwd, ".pi"));
  await symlink(join(root, "later"), join(cwd, ".pi", "skills"));
  assert.equal((await trustFreshFolderAndWrite(cwd, agentDir, write, { knownFolders: [] })).reason, "folder-not-fresh");
  await rm(join(cwd, ".pi"), { recursive: true });

  // A decision made elsewhere meanwhile, for the folder or above it, either way.
  for (const [path, decision] of [[cwd, false], [cwd, true], [root, true], [root, false]]) {
    store.set(path, decision);
    result = await trustFreshFolderAndWrite(cwd, agentDir, write, { knownFolders: [] });
    assert.equal(result.reason, "folder-not-fresh", `${path} ${decision}`);
    assert.equal(result.status.decision, decision);
    store.set(path, null);
  }
  assert.equal(writes, 0);
  assert.deepEqual(trustJson(agentDir), {});
});

test("an unreadable trust store refuses the step before anything is written", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await writeFile(join(agentDir, "trust.json"), "{ not json");
  let writes = 0;
  const result = await trustFreshFolderAndWrite(cwd, agentDir, () => {
    writes += 1;
  }, { knownFolders: [] });
  assert.equal(result.reason, "trust-unreadable");
  assert.match(result.error, /trust\.json/);
  assert.equal(writes, 0);
});

test("a folder whose trust would reach further is never trusted by itself", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const home = join(root, "home");
  await mkdir(join(home, "repo"), { recursive: true });
  const breadth = (folder, options = {}) => freshFolderTrustBreadth(folder, { agentDir, knownFolders: [], home, ...options });

  assert.deepEqual(breadth(home), { kind: "home", path: home });
  assert.deepEqual(breadth(root), { kind: "contains-home", path: home }, "an ancestor of the home folder");
  const filesystemRoot = realpathSync("/");
  assert.deepEqual(breadth(filesystemRoot), { kind: "root", path: filesystemRoot });
  assert.deepEqual(breadth(dirname(agentDir), { home: join(tmpdir(), "elsewhere") }), { kind: "contains-agent-dir", path: agentDir });
  assert.deepEqual(breadth(agentDir, { home: join(tmpdir(), "elsewhere") }), { kind: "contains-agent-dir", path: agentDir }, "the agent folder itself");
  const inside = join(cwd, "packages", "app");
  await mkdir(inside, { recursive: true });
  assert.deepEqual(breadth(cwd, { knownFolders: [cwd, inside] }), { kind: "contains-folder", path: inside }, "a session folder inside it");
  assert.equal(breadth(cwd, { knownFolders: [cwd, join(root, "agent"), home] }), undefined, "itself, its siblings and above are fine");
  assert.equal(breadth(join(home, "repo")), undefined, "a folder inside the home folder is fine");

  let writes = 0;
  const result = await trustFreshFolderAndWrite(cwd, agentDir, () => {
    writes += 1;
  }, { knownFolders: [inside], home });
  assert.equal(result.reason, "trust-too-broad");
  assert.deepEqual(result.breadth, { kind: "contains-folder", path: inside });
  assert.equal(writes, 0);
  assert.deepEqual(trustJson(agentDir), {});
});

test("a fresh folder that holds a project with no decision is never trusted by the step", async (t) => {
  // ~/work, never opened as a project, holds a repository cloned into it that Pi Web has not opened either.
  const { root, agentDir } = await createProjectFixture(t);
  const home = join(root, "home");
  const work = join(home, "work");
  const repo = join(work, "cloned-repo");
  await mkdir(join(repo, ".pi", "extensions"), { recursive: true });
  await writeFile(join(repo, ".pi", "extensions", "evil.ts"), "export default () => {};\n");
  const breadth = (folder) => freshFolderTrustBreadth(folder, { agentDir, knownFolders: [folder], home });
  assert.equal(hasTrustRelevantEntries(work, home), false, "the folder itself needs no trust");
  assert.deepEqual(getProjectTrustStatus(repo, agentDir), { requiresTrust: true, trusted: false, decision: null, inherited: false });
  assert.deepEqual(breadth(work), { kind: "contains-project", path: repo });
  assert.deepEqual(findInheritingTrustProject(work, agentDir), { kind: "contains-project", path: repo });

  let writes = 0;
  const result = await trustFreshFolderAndWrite(work, agentDir, () => {
    writes += 1;
  }, { knownFolders: [work], home });
  assert.equal(result.reason, "trust-too-broad");
  assert.deepEqual(result.breadth, { kind: "contains-project", path: repo });
  assert.equal(writes, 0);
  assert.deepEqual(trustJson(agentDir), {});
  assert.deepEqual(getProjectTrustStatus(repo, agentDir).trusted, false);

  // A decision of its own, either way, wins over one for the folder above: nothing would change for it.
  const store = new ProjectTrustStore(agentDir);
  for (const decision of [false, true]) {
    store.set(repo, decision);
    assert.equal(breadth(work), undefined, String(decision));
    store.set(repo, null);
  }
});

test("the scan below a fresh folder finds each kind of project, deep enough and no further", async (t) => {
  const { root, agentDir } = await createProjectFixture(t);
  const work = join(root, "work");
  const found = () => findInheritingTrustProject(work, agentDir);
  await mkdir(work);
  assert.equal(found(), undefined, "an empty folder");

  for (const entry of TRUST_REQUIRING_PROJECT_ENTRIES) {
    const repo = join(work, "org", "repo");
    await mkdir(join(repo, ".pi"), { recursive: true });
    await writeFile(join(repo, ".pi", entry), "");
    assert.deepEqual(found(), { kind: "contains-project", path: repo }, entry);
    await rm(join(work, "org"), { recursive: true });
  }
  await mkdir(join(work, "skills-repo", ".agents", "skills"), { recursive: true });
  assert.deepEqual(found(), { kind: "contains-project", path: join(work, "skills-repo") });
  await rm(join(work, "skills-repo"), { recursive: true });
  // A .pi that is a link to nothing needs trust the moment its target appears.
  await mkdir(join(work, "linked"));
  await symlink(join(root, "not-yet"), join(work, "linked", ".pi"));
  assert.deepEqual(found(), { kind: "contains-project", path: join(work, "linked") });
  await rm(join(work, "linked"), { recursive: true });

  // An empty .pi, dependencies and history are not projects.
  await mkdir(join(work, "plain", ".pi"), { recursive: true });
  await mkdir(join(work, "app", "node_modules", "dep", ".pi", "extensions"), { recursive: true });
  await mkdir(join(work, "app", ".git", "x", ".pi", "extensions"), { recursive: true });
  assert.equal(found(), undefined);

  // Four levels down is found, five is past the scan.
  await mkdir(join(work, "a", "b", "c", "d", ".pi", "extensions"), { recursive: true });
  assert.deepEqual(found(), { kind: "contains-project", path: join(work, "a", "b", "c", "d") });
  await rm(join(work, "a"), { recursive: true });
  await mkdir(join(work, "a", "b", "c", "d", "e", ".pi", "extensions"), { recursive: true });
  assert.equal(found(), undefined);
  await rm(join(work, "a"), { recursive: true });

  // A link to a project elsewhere is not followed: trust is keyed by real path, so it would not inherit.
  const elsewhere = join(root, "elsewhere");
  await mkdir(join(elsewhere, ".pi", "extensions"), { recursive: true });
  await symlink(elsewhere, join(work, "link"));
  assert.equal(found(), undefined);
});

test("a folder too large to scan is refused rather than trusted unchecked", async (t) => {
  const { root, agentDir } = await createProjectFixture(t);
  const work = join(root, "work");
  await Promise.all(Array.from({ length: NESTED_PROJECT_SCAN_MAX_FOLDERS }, (_, index) => mkdir(join(work, `d${index}`), { recursive: true })));
  assert.deepEqual(findInheritingTrustProject(work, agentDir), { kind: "too-many-folders", path: work });
  assert.deepEqual(freshFolderTrustBreadth(work, { agentDir, knownFolders: [], home: join(root, "home") }), { kind: "too-many-folders", path: work });
});

test("a project cloned into the folder after the panel offered the step stops it inside the chain", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  assert.equal(freshFolderTrustBreadth(cwd, { agentDir, knownFolders: [] }), undefined);
  // The first step's write lands a project below the folder while the second waits for its turn.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = trustFreshFolderAndWrite(cwd, agentDir, async () => {
    await gate;
    throw new Error("write failed");
  }, { knownFolders: [] });
  const second = trustFreshFolderAndWrite(cwd, agentDir, () => "written", { knownFolders: [] });
  await mkdir(join(cwd, "cloned", ".pi", "extensions"), { recursive: true });
  release();
  assert.equal((await first).reason, "write-failed");
  const result = await second;
  assert.equal(result.reason, "trust-too-broad");
  assert.deepEqual(result.breadth, { kind: "contains-project", path: join(cwd, "cloned") });
  assert.deepEqual(trustJson(agentDir), {});
});

test("a step that waits for the folder gets its turn after an earlier one failed and was undone", async (t) => {
  // Unchained, the second step would run while the first awaits its write, find the first one's
  // decision and be refused, although that write then fails and the decision is taken back.
  const { cwd, agentDir } = await createProjectFixture(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const first = trustFreshFolderAndWrite(cwd, agentDir, async () => {
    order.push("first writes");
    await gate;
    throw new Error("disk full");
  }, { knownFolders: [] });
  const second = trustFreshFolderAndWrite(cwd, agentDir, async () => {
    order.push("second writes");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
    return "written";
  }, { knownFolders: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["first writes"], "the second has not looked at the folder yet");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.reason, "write-failed");
  assert.equal(a.rollbackError, undefined);
  assert.deepEqual(order, ["first writes", "second writes"]);
  assert.equal(b.ok, true, "the folder was fresh again once the first step was undone");
  assert.equal(b.value, "written");
  assert.deepEqual(trustJson(agentDir), { [cwd]: true });
});

test("of two steps for one folder at once, the later finds it no longer fresh and takes nothing back", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const first = trustFreshFolderAndWrite(cwd, agentDir, async () => {
    order.push("first writes");
    await gate;
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "mcp.json"), "{}");
  }, { knownFolders: [] });
  const second = trustFreshFolderAndWrite(cwd, agentDir, () => {
    order.push("second writes");
  }, { knownFolders: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["first writes"], "the second does not write meanwhile");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.reason, "folder-not-fresh", "it now has .pi/mcp.json and a decision");
  assert.equal(b.status.trusted, true);
  assert.deepEqual(order, ["first writes"]);
  assert.deepEqual(trustJson(agentDir), { [cwd]: true }, "and its refusal took nothing back");
});
