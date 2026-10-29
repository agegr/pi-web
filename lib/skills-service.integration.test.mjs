import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The skills listing (Settings › Skills, the chat slash palette) loads no
// extensions (#1226): they add skills only through `resources_discover` at
// session_start, which a listing never runs. Every extension below counts its
// import, and the listing must still show global, package and project skills.
const root = await mkdtemp(join(tmpdir(), "pi-web-skills-service-"));
// A project's .agents/skills are looked up in every folder up to its git root,
// or the filesystem root outside a repository. On Windows tmpdir() lies inside
// the developer's profile, whose own ~/.agents/skills would join the listing:
// the fixture tree is made a repository root so the lookup ends there.
await mkdir(join(root, ".git"));
const agentDir = join(root, "agent");
const home = join(root, "home");
const pkg = join(root, "local-pkg");
const trustedProject = join(root, "trusted");
const untrustedProject = join(root, "untrusted");
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.HOME = home;
// Windows: os.homedir() reads %USERPROFILE%, not $HOME.
process.env.USERPROFILE = home;
process.env.PI_OFFLINE = "1";

const countedExtension = (name) => `
(globalThis as any).__piWebSkillsTestImports ??= [];
(globalThis as any).__piWebSkillsTestImports.push(${JSON.stringify(name)});
export default function (pi: any) {
  pi.on("resources_discover", () => ({ skillPaths: [${JSON.stringify(join(root, "discovered"))}] }));
}
`;

async function skill(dir, name) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`);
}

await mkdir(home, { recursive: true });
await mkdir(join(agentDir, "extensions"), { recursive: true });
await writeFile(join(agentDir, "extensions", "global.ts"), countedExtension("global"));
await skill(join(agentDir, "skills"), "global-skill");
await skill(join(root, "discovered"), "discovered-skill");

await mkdir(join(pkg, "extensions"), { recursive: true });
await writeFile(join(pkg, "extensions", "index.ts"), countedExtension("package"));
await skill(join(pkg, "skills"), "package-skill");
await writeFile(join(pkg, "package.json"), JSON.stringify({
  name: "local-pkg",
  version: "1.0.0",
  pi: { skills: ["./skills"], extensions: ["./extensions"] },
}));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));

for (const project of [trustedProject, untrustedProject]) {
  await mkdir(join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(join(project, ".pi", "extensions", "project.ts"), countedExtension(project));
  await skill(join(project, ".pi", "skills"), "project-pi-skill");
  await skill(join(project, ".agents", "skills"), "project-agents-skill");
}

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { projectTrustReloadOptions, trustProject } = await jiti.import("./project-trust.ts");
const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");

trustProject(trustedProject, agentDir);

const imports = () => globalThis.__piWebSkillsTestImports ?? [];
const names = (skills) => skills.map((entry) => entry.name).sort();

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the listing imports no extension and still lists global, package and trusted project skills", async () => {
  const listed = await loadSkillsWithInstallInfo(trustedProject);
  assert.deepEqual(imports(), []);
  assert.equal(listed.projectResourcesLoaded, true);
  assert.deepEqual(names(listed.skills), [
    "global-skill",
    "package-skill",
    "project-agents-skill",
    "project-pi-skill",
  ]);
});

test("an untrusted project's skills stay out, and its extensions are not imported", async () => {
  const listed = await loadSkillsWithInstallInfo(untrustedProject);
  assert.deepEqual(imports(), []);
  assert.equal(listed.projectResourcesLoaded, false);
  assert.ok(!names(listed.skills).includes("project-pi-skill"));
  assert.ok(names(listed.skills).includes("global-skill"));
});

test("loading the extensions would list exactly the same skills", async () => {
  const listed = await loadSkillsWithInstallInfo(trustedProject);
  const withExtensions = new DefaultResourceLoader({ cwd: trustedProject, agentDir });
  await withExtensions.reload(projectTrustReloadOptions(trustedProject, agentDir));
  assert.ok(imports().length > 0, "the full loader imports the extensions");
  const paths = (skills) => skills.map((entry) => [entry.name, entry.filePath]).sort();
  assert.deepEqual(paths(listed.skills), paths(withExtensions.getSkills().skills));
  // `resources_discover` runs only at session_start, which neither loader reaches.
  assert.ok(!names(listed.skills).includes("discovered-skill"));
});
