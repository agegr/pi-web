import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const sandbox = await mkdtemp(join(tmpdir(), "pi-resource-route-"));
const previous = process.env.PI_CODING_AGENT_DIR;
const previousHome = process.env.HOME;
process.env.HOME = join(sandbox, "home");
await mkdir(process.env.HOME);
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
after(async () => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(sandbox, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GET } = await jiti.import("./route.ts");
const profiles = await jiti.import("../profiles/route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { parseFrontmatter } = await jiti.import("../../../../lib/frontmatter.ts");
function request(cwd) { return new Request(`http://localhost/api/subagents/resources?cwd=${encodeURIComponent(cwd)}`); }
function profileRequest(method, body) { return new Request("http://localhost/api/subagents/profiles", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

test("resource GET is guarded, static, and returns configured/default/project resources without trust", async () => {
  const cwd = join(sandbox, "project"); await mkdir(cwd); allowFileRoot(cwd);
  const extDir = join(cwd, ".pi", "extensions"); await mkdir(extDir, { recursive: true });
  await writeFile(join(extDir, "static.ts"), "throw new Error('catalog must not execute a module'); export default () => {};\n");
  const skillsDir = join(process.env.PI_CODING_AGENT_DIR, "configured"); await mkdir(skillsDir, { recursive: true });
  await writeFile(join(skillsDir, "skill.md"), "---\nname: configured-name\ndescription: Fixture\n---\nFixture");
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ skills: ["./configured/skill.md"] }));
  const response = await GET(request(cwd)); assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.ok(catalog.extensions.some((entry) => entry.metadata.scope === "project" && entry.name === "static"));
  assert.ok(catalog.skills.some((entry) => entry.name === "configured-name"));
  assert.equal((await GET(new Request("http://localhost/api/subagents/resources"))).status, 400);
  const forbidden = join(sandbox, "forbidden"); await mkdir(forbidden);
  assert.equal((await GET(request(forbidden))).status, 403);
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "{");
  const failed = await GET(request(cwd)); assert.equal(failed.status, 400); assert.match((await failed.json()).error, /settings/);
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "{}");
  assert.equal((await GET(request(cwd))).status, 200, "retry after correcting the static file");
});

test("resource GET never executes an untrusted project's npmCommand during global missing-package root lookup", async (t) => {
  const cwd = join(sandbox, "command-project"); await mkdir(join(cwd, ".pi"), { recursive: true }); allowFileRoot(cwd);
  const marker = join(sandbox, "project-command.marker");
  const script = join(cwd, "npm.cjs");
  await writeFile(script, `require('fs').appendFileSync(${JSON.stringify(marker)}, 'executed\\n'); throw Error('untrusted project command');`);
  const hostLog = join(sandbox, "host-command.log");
  const hostScript = join(sandbox, "host-npm.cjs");
  await writeFile(hostScript, `require('fs').appendFileSync(${JSON.stringify(hostLog)}, JSON.stringify(process.argv.slice(2))+'\\n'); if(process.argv.includes('root')) console.log(${JSON.stringify(join(sandbox, "host-modules"))}); else throw Error('network forbidden');`);
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const settingsPath = join(agentDir, "settings.json");
  await mkdir(agentDir, { recursive: true });
  const previousSettings = await readFile(settingsPath, "utf8").catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
  t.after(() => previousSettings === undefined ? rm(settingsPath, { force: true }) : writeFile(settingsPath, previousSettings));
  await writeFile(settingsPath, JSON.stringify({ packages: ["npm:@fixture/route-missing@1.0.0"], npmCommand: [process.execPath, hostScript] }));
  await writeFile(join(cwd, ".pi", "visible.ts"), "export default () => {};\n");
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ npmCommand: [process.execPath, script], extensions: ["./visible.ts"] }));
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(agentDir).set(cwd, false);
  const response = await GET(request(cwd)); assert.equal(response.status, 200);
  const catalog = await response.json();
  await assert.rejects(access(marker), "project command marker must be absent");
  assert.ok(catalog.extensions.some((entry) => entry.name === "visible" && entry.metadata.scope === "project"), "untrusted project declarations remain statically editable");
  assert.ok(catalog.diagnostics.some((entry) => entry.message.includes("route-missing") && entry.message.includes("not installed")));
  const hostCalls = await readFile(hostLog, "utf8"); assert.match(hostCalls, /root/); assert.doesNotMatch(hostCalls, /install|view|update/);
});

test("builtin clone rejects an occupied target with 409 without changing any bytes", async () => {
  const cwd = join(sandbox, "builtin-clone"); await mkdir(cwd); allowFileRoot(cwd);
  const listing = await profiles.GET(new Request(`http://localhost/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`));
  const builtin = (await listing.json()).profiles.find((entry) => entry.scope === "builtin" && entry.name === "explore");
  assert.ok(builtin);
  const existing = await profiles.PUT(profileRequest("PUT", { cwd, scope: "global", profile: { ...builtin, name: "occupied", systemPrompt: "KEEP ORIGINAL PROMPT" } }));
  assert.equal(existing.status, 200);
  const path = (await existing.json()).profile.filePath;
  const before = await readFile(path);
  const denied = await profiles.PUT(profileRequest("PUT", { cwd, scope: "global", profile: { ...builtin, name: "occupied" }, cloneFrom: { scope: "builtin", name: "explore" } }));
  assert.equal(denied.status, 409);
  assert.deepEqual(await readFile(path), before);
  const created = await profiles.PUT(profileRequest("PUT", { cwd, scope: "global", profile: { ...builtin, name: "new-builtin-copy" }, cloneFrom: { scope: "builtin", name: "explore" } }));
  assert.equal(created.status, 200);
  assert.equal((await created.json()).profile.systemPrompt, builtin.systemPrompt);
});

test("PUT/PATCH/clone deliver independent normalized selections and round-trip foreign YAML + ext tools", async () => {
  const cwd = join(sandbox, "profiles"); await mkdir(cwd); allowFileRoot(cwd);
  const path = join(cwd, ".pi", "agents", "original.md"); await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "---\nname: original\nskills: 'one, unknown'\nextensions: [foo, './other.ts']\nload_skills: true\nload_extensions: true\ntools: 'read, ext:foo/lookup'\nforeign: {kept: true}\nisolation: off\npersist_session: false\n---\nFixture prompt\n");
  const listing = await profiles.GET(new Request(`http://localhost/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`));
  const original = (await listing.json()).profiles.find((p) => p.name === "original");
  assert.deepEqual(original.skills, ["one", "unknown"]); assert.deepEqual(original.extensions, ["foo", "./other.ts"]);
  const unrelated = join(sandbox, "do-not-write.md"); await writeFile(unrelated, "KEEP");
  const patched = await profiles.PATCH(profileRequest("PATCH", { cwd, scope: "project", name: "original", enabled: false, filePath: unrelated, profile: { filePath: unrelated } }));
  assert.equal(patched.status, 200); assert.deepEqual((await patched.json()).profile.extensions, original.extensions);
  const raw = parseFrontmatter(await readFile(path, "utf8")).data;
  assert.equal(raw.skills, "one, unknown"); assert.deepEqual(raw.foreign, { kept: true }); assert.match(raw.tools, /ext:foo\/lookup/);
  assert.equal(raw.enabled, false);
  assert.equal(await readFile(unrelated, "utf8"), "KEEP");
  const cloned = await profiles.PUT(profileRequest("PUT", { cwd, scope: "global", profile: { ...original, name: "copied" }, cloneFrom: { scope: "project", name: "original" } }));
  assert.equal(cloned.status, 200);
  const saved = (await cloned.json()).profile;
  const cloneYaml = parseFrontmatter(await readFile(saved.filePath, "utf8")).data;
  assert.equal(cloneYaml.name, "copied"); assert.deepEqual(cloneYaml.foreign, raw.foreign); assert.equal(cloneYaml.skills, raw.skills);
  const updated = await profiles.PUT(profileRequest("PUT", { cwd, scope: "global", profile: { ...saved, skills: true, extensions: [] } }));
  assert.equal(updated.status, 200); assert.equal((await updated.json()).profile.skills, true);
  const savedYaml = parseFrontmatter(await readFile(saved.filePath, "utf8")).data;
  assert.equal(savedYaml.skills, true); assert.deepEqual(savedYaml.extensions, []); assert.match(savedYaml.tools, /ext:foo\/lookup/);
  const forged = await profiles.PUT(profileRequest("PUT", { cwd, scope: "project", profile: { ...original, name: "derived-target", filePath: unrelated } }));
  assert.equal(forged.status, 200);
  assert.equal((await forged.json()).profile.filePath, join(cwd, ".pi", "agents", "derived-target.md"));
  assert.equal(await readFile(unrelated, "utf8"), "KEEP");
  const before = await readFile(path);
  const conflict = await profiles.PUT(profileRequest("PUT", { cwd, scope: "project", profile: original, cloneFrom: { scope: "project", name: "original" } }));
  assert.equal(conflict.status, 409); assert.deepEqual(await readFile(path), before);
  const invalid = await profiles.PUT(profileRequest("PUT", { cwd, scope: "project", profile: { ...original, skills: "invalid API" } }));
  assert.equal(invalid.status, 400);
});
