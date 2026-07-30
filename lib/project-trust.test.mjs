import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import {
  getProjectTrustStatus,
  projectTrustReloadOptions,
  trustProject,
} from "./project-trust.ts";

async function createProjectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-trust-"));
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
  });
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined);
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
  });

  const restrictedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await restrictedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), false);
  assert.equal(restrictedLoader.getExtensions().extensions.length, 0);

  assert.deepEqual(trustProject(cwd, agentDir), {
    requiresTrust: true,
    trusted: true,
  });

  const trustedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await trustedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), true);
  assert.equal(trustedLoader.getExtensions().extensions.length, 1);
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

test("all project resource loaders and reloads enforce project trust", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const modelsSource = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  const skillsSource = await readFile(new URL("./skills-service.ts", import.meta.url), "utf8");
  const skillsInstallSource = await readFile(new URL("../app/api/skills/install/route.ts", import.meta.url), "utf8");
  const pluginsSource = await readFile(new URL("../app/api/plugins/route.ts", import.meta.url), "utf8");

  assert.match(rpcSource, /projectTrustReloadOptions\(cwd, agentDir\)/);
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
  assert.match(rpcSource, /trackStartingSession\(cwd\)/);
  assert.match(rpcSource, /realpathSync\(resolvedCwd\)/);
});
