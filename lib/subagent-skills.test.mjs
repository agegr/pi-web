import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const { createSubagentSkillsBinding } = await createJiti(import.meta.url).import("./subagent-skills.ts");

// A disabled skill switch must remain off even if an extension contributes explicit paths.
test("explicit disable suppresses extension-contributed public skills", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "skill-extension-off-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "EXTRA.md");
  await writeFile(file, "---\nname: extra\ndescription: extra routing\n---\nEXTRA_BODY");
  const binding = createSubagentSkillsBinding({ loadSkills: false, skills: ["extra"] });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory(), noExtensions: true, ...binding.loaderOptions });
  await loader.reload();
  loader.extendResources({ skillPaths: [{ path: file, metadata: { source: "extension-test", origin: "extension", scope: "user" } }] });
  assert.deepEqual(loader.getSkills().skills, []);
});

test("named discovery preserves SDK diagnostics while hiding collision winners privately", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "skill-diagnostics-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const folder of ["first", "second"]) {
    await mkdir(join(dir, "skills", folder), { recursive: true });
    await writeFile(join(dir, "skills", folder, "SKILL.md"), `---\nname: same\ndescription: routing\n---\n${folder}`);
  }
  const ordinary = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory(), noExtensions: true });
  await ordinary.reload();
  const binding = createSubagentSkillsBinding({ loadSkills: true, skills: ["same"] });
  const scoped = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory(), noExtensions: true, ...binding.loaderOptions });
  await scoped.reload();
  assert.ok(ordinary.getSkills().diagnostics.length > 0);
  assert.deepEqual(scoped.getSkills().diagnostics, ordinary.getSkills().diagnostics);
  assert.deepEqual(scoped.getSkills().skills, []);
});
