import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizeProjectPreferences } = await import("./project-registry-core.ts");
const { updateProjectPreference } = await createJiti(import.meta.url).import("./project-registry.ts");

test("normalizes project metadata without changing project paths", () => {
  const projectPath = resolve("project-a");
  assert.deepEqual(normalizeProjectPreferences([{
    path: projectPath,
    name: "  Project A  ",
    pinned: true,
    archived: false,
    removed: false,
    order: 4,
  }]), [{
    path: projectPath,
    name: "Project A",
    pinned: true,
    archived: false,
    removed: false,
    order: 4,
  }]);
});

test("rejects duplicate and relative project paths", () => {
  const projectPath = resolve("project-a");
  assert.throws(() => normalizeProjectPreferences([{ path: "relative", order: 0 }]));
  assert.throws(() => normalizeProjectPreferences([
    { path: projectPath, order: 0 },
    { path: projectPath, order: 1 },
  ]));
});

test("updates one project without overwriting concurrent project metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-project-registry-"));
  const registryPath = join(directory, "projects.json");
  const firstPath = resolve(directory, "project-a");
  const secondPath = resolve(directory, "project-b");
  await writeFile(registryPath, JSON.stringify({
    version: 1,
    projects: [
      { path: firstPath, pinned: false, archived: true, removed: false, order: 0 },
      { path: secondPath, name: "Current name", pinned: true, archived: true, removed: false, order: 1 },
    ],
  }));

  try {
    await Promise.all([
      updateProjectPreference(firstPath, { archived: false }, registryPath),
      updateProjectPreference(secondPath, { archived: false }, registryPath),
    ]);
    const stored = JSON.parse(await readFile(registryPath, "utf8"));
    assert.deepEqual(stored.projects, [
      { path: firstPath, pinned: false, archived: false, removed: false, order: 0 },
      { path: secondPath, name: "Current name", pinned: true, archived: false, removed: false, order: 1 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
