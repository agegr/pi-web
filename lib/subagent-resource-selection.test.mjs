import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const dir = await mkdtemp(join(tmpdir(), "pi-resource-profile-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalHome = process.env.HOME;
process.env.HOME = join(dir, "home");
await mkdir(process.env.HOME);
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
after(async () => { if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome; if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalAgentDir; await rm(dir, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { parseResourceSelection, profileResourceSelection, resourceMatchCandidates, matchingResourceEntries } = await jiti.import("./subagent-resource-selection.ts");
const { listSubagentProfileSources, saveSubagentProfile, readSubagentSessionResources, SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { parseFrontmatter } = await jiti.import("./frontmatter.ts");

for (const [input, expected] of [[true, true], [false, false], ["all", true], ["none", false], ["", []], [[], []], ["One, two", ["One", "two"]], [["*", "/a.ts", "unknown"], ["*", "/a.ts", "unknown"]]]) {
  test(`normalizes alias ${JSON.stringify(input)} without broadening`, () => assert.deepEqual(parseResourceSelection(input), expected));
}
test("raw matching retains aliases and ambiguity; identity guard and slash/case rules stay unchanged", () => {
  const first = { path: "/A/one.md", identity: "/real/one.md", names: ["one"], pathAliases: ["./one.md", "/A/one.md"] };
  const alias = { path: "/alias/one.md", identity: first.identity, names: ["one"] };
  const other = { path: "/B/one.md", identity: "/real/other.md", names: ["one"] };
  assert.deepEqual(resourceMatchCandidates("ONE", [first, alias]), [first, alias]);
  assert.deepEqual(matchingResourceEntries("ONE", [first, alias]), [first, alias]);
  assert.deepEqual(resourceMatchCandidates("one", [first, alias, other]), [first, alias, other]);
  assert.deepEqual(matchingResourceEntries("one", [first, alias, other]), []);
  assert.deepEqual(matchingResourceEntries(".\\one.md", [first, other]), [first]);
  assert.deepEqual(resourceMatchCandidates("/a/one.md", [first]), [], "path case stays significant");
  assert.deepEqual(resourceMatchCandidates("/real/one.md", [alias]), [alias], "fallback includes canonical identity");
  assert.deepEqual(resourceMatchCandidates("/real/one.md", [first]), [], "supplied aliases remain authoritative");
  assert.deepEqual(matchingResourceEntries("unknown", [first]), []);
});

test("legacy false closes and legacy true does not erase an alias whitelist", () => {
  assert.deepEqual(profileResourceSelection("one,two", true), ["one", "two"]);
  assert.equal(profileResourceSelection(["one"], false), false);
});

async function storedProfile(cwd, name, yaml) {
  const path = join(cwd, ".pi", "agents", `${name}.md`);
  await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, `---\n${yaml}\n---\nOriginal prompt.\n`);
  return { path, profile: listSubagentProfileSources(cwd).find((p) => p.name === name) };
}

test("unchanged CSV/array lists and foreign metadata survive saves, PATCH-style spread, and clones across scopes", async () => {
  const cwd = join(dir, "project"); await mkdir(cwd);
  const { path, profile } = await storedProfile(cwd, "csv", "name: csv\nskills: 'One, unknown'\nextensions: [foo, './local.ts', '*']\nload_skills: true\nload_extensions: true\ntools: 'read, ext:foo/search'\nforeign: {nested: [keep, 9]}\nallowed_subagents: [plan]\nisolation: off\npersist_session: false");
  assert.deepEqual(profile.skills, ["One", "unknown"]); assert.deepEqual(profile.extensions, ["foo", "./local.ts", "*"]);
  const saved = saveSubagentProfile(cwd, "project", { ...profile, description: "Edited", enabled: false });
  const raw = parseFrontmatter(await readFile(path, "utf8")).data;
  assert.equal(raw.skills, "One, unknown"); assert.deepEqual(raw.extensions, ["foo", "./local.ts", "*"]);
  assert.deepEqual(raw.foreign, { nested: ["keep", 9] }); assert.deepEqual(raw.allowed_subagents, ["plan"]);
  assert.match(raw.tools, /ext:foo\/search/); assert.deepEqual(saved.extensions, profile.extensions);
  const clone = saveSubagentProfile(cwd, "global", { ...saved, name: "clone", displayName: "Clone" }, profile);
  const cloned = parseFrontmatter(await readFile(clone.filePath, "utf8")).data;
  assert.equal(cloned.name, "clone"); assert.equal(cloned.skills, raw.skills); assert.deepEqual(cloned.extensions, raw.extensions);
  assert.deepEqual(cloned.foreign, raw.foreign); assert.match(cloned.tools, /ext:foo\/search/);
  assert.equal(listSubagentProfileSources(cwd).find((p) => p.name === "clone").scope, "global");
});

test("old boolean clients can disable and re-enable without losing dormant whitelists; all writes YAML true", async () => {
  const cwd = join(dir, "legacy"); await mkdir(cwd);
  const { path, profile } = await storedProfile(cwd, "legacy", "skills: ['one', 'unknown']\nextensions: foo, unknown\nload_skills: false\nload_extensions: false");
  assert.equal(profile.skills, false); assert.equal(profile.extensions, false);
  saveSubagentProfile(cwd, "project", { ...profile, description: "Unrelated save" });
  let raw = parseFrontmatter(await readFile(path, "utf8")).data;
  assert.deepEqual(raw.skills, ["one", "unknown"]); assert.equal(raw.extensions, "foo, unknown");
  const legacy = { ...profile }; delete legacy.skills; delete legacy.extensions;
  saveSubagentProfile(cwd, "project", { ...legacy, loadSkills: true, loadExtensions: true });
  const readback = listSubagentProfileSources(cwd).find((p) => p.name === "legacy");
  assert.deepEqual(readback.skills, ["one", "unknown"]); assert.deepEqual(readback.extensions, ["foo", "unknown"]);
  saveSubagentProfile(cwd, "project", { ...readback, skills: true, extensions: false });
  raw = parseFrontmatter(await readFile(path, "utf8")).data;
  assert.equal(raw.skills, true); assert.equal(raw.extensions, false); assert.equal(raw.load_extensions, false);
  saveSubagentProfile(cwd, "project", { ...readback, skills: [], extensions: ["unknown"] });
  raw = parseFrontmatter(await readFile(path, "utf8")).data;
  assert.deepEqual(raw.skills, []); assert.deepEqual(raw.extensions, ["unknown"]);
  assert.throws(() => saveSubagentProfile(cwd, "project", { ...readback, skills: "bad API" }), /boolean or string\[\]/);
});

test("old snapshots stay boolean-compatible and new selected snapshots restore independently", () => {
  const entries = (snapshot) => [{ type: "custom", customType: SUBAGENT_META_TYPE, data: { version: 1, parentSessionId: "parent", parentSessionPath: "/parent.jsonl", resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: ["read"], ...snapshot } } }];
  assert.equal(readSubagentSessionResources(entries({ loadSkills: true, loadExtensions: false })).loadSkills, true);
  assert.deepEqual(readSubagentSessionResources(entries({ loadSkills: true, loadExtensions: true, skills: ["one"], extensions: [] })).skills, ["one"]);
  assert.deepEqual(readSubagentSessionResources(entries({ loadSkills: true, loadExtensions: true, skills: ["one"], extensions: [] })).extensions, []);
  assert.equal(readSubagentSessionResources(entries({ loadSkills: true, skills: { invalid: true } })), null);
});
