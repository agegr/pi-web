import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  codemodePreferenceOf,
  projectCodemodePreference,
  readCodemodePreference,
  readProjectCodemodeOverride,
  withCodemodePreference,
  writeCodemodePreference,
} = await jiti.import("./codemode-settings.ts");
const { writePowerShellToolEnabled } = await jiti.import("./powershell-settings.ts");

test("Code mode is always on only when the resolved defaultTools list holds codemode", () => {
  assert.equal(codemodePreferenceOf(undefined), "automatic");
  assert.equal(codemodePreferenceOf([]), "automatic");
  assert.equal(codemodePreferenceOf(["+codemode"]), "always");
  assert.equal(codemodePreferenceOf(["read", "codemode"]), "always");
  assert.equal(codemodePreferenceOf(["+codemode", "-codemode"]), "automatic");
  assert.equal(codemodePreferenceOf(["read", "+grep"]), "automatic");
});

test("switching Code mode edits only the entries that name codemode", () => {
  // Unset: a modifier keeps pi's defaults instead of freezing today's list.
  assert.deepEqual(withCodemodePreference(undefined, "always"), ["+codemode"]);
  assert.deepEqual(withCodemodePreference(["+grep", "-write"], "always"), ["+grep", "-write", "+codemode"]);
  assert.deepEqual(withCodemodePreference(["read", "bash"], "always"), ["read", "bash", "+codemode"]);
  assert.deepEqual(withCodemodePreference(["read", "codemode", "-codemode"], "always"), ["read", "+codemode"]);

  assert.deepEqual(withCodemodePreference(["read", "codemode", "bash"], "automatic"), ["read", "bash"]);
  assert.deepEqual(withCodemodePreference(["+grep", "+codemode"], "automatic"), ["+grep"]);
  // An empty list means no tools at all, so a list of only modifiers is removed instead.
  assert.equal(withCodemodePreference(["+codemode"], "automatic"), undefined);
  assert.equal(withCodemodePreference(undefined, "automatic"), undefined);
  // A plain list that selected only codemode keeps meaning "these tools": now none.
  assert.deepEqual(withCodemodePreference(["codemode"], "automatic"), []);
});

test("writing Code mode keeps other settings and leaves an unchanged file alone", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  assert.equal(await readCodemodePreference(settingsPath), "automatic");
  await assert.rejects(stat(settingsPath), { code: "ENOENT" }, "reading does not create the file");

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", defaultTools: ["+grep"] }));
  assert.equal(await writeCodemodePreference("always", settingsPath), "always");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultModel: "m",
    defaultTools: ["+grep", "+codemode"],
  });
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);

  const before = await readFile(settingsPath, "utf8");
  await writeFile(settingsPath, before.replace(/\n\s*/g, ""));
  const compact = await readFile(settingsPath, "utf8");
  assert.equal(await writeCodemodePreference("always", settingsPath), "always");
  assert.equal(await readFile(settingsPath, "utf8"), compact, "an unchanged preference is not rewritten");

  assert.equal(await writeCodemodePreference("automatic", settingsPath), "automatic");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", defaultTools: ["+grep"] });

  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  await writeCodemodePreference("automatic", settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});
});

test("Code mode survives the PowerShell switch, which rewrites the list as plain names", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-powershell-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  await writeCodemodePreference("always", settingsPath);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, ["read", "powershell", "edit", "write", "codemode"]);
  assert.equal(await readCodemodePreference(settingsPath), "always");

  await writeCodemodePreference("automatic", settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, ["read", "powershell", "edit", "write"]);
});

test("an unreadable settings file is reported, not overwritten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, "{ not json");
  await assert.rejects(writeCodemodePreference("always", settingsPath), SyntaxError);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: "codemode" }));
  await assert.rejects(readCodemodePreference(settingsPath), /defaultTools must be an array of strings/);
});

test("a project's defaultTools decides Code mode only where the global choice no longer matters", () => {
  const project = (defaultTools) => projectCodemodePreference(JSON.stringify({ defaultTools }));
  // A plain list replaces the global list, +codemode and all.
  assert.equal(project(["read", "bash"]), "automatic");
  assert.equal(project(["read", "codemode"]), "always");
  // Modifiers are appended to the global list, so one naming codemode has the last word.
  assert.equal(project(["-codemode"]), "automatic");
  assert.equal(project(["+codemode"]), "always");
  assert.equal(project(["+codemode", "-codemode"]), "automatic");
  assert.equal(project(["-codemode", "+codemode"]), "always");
  // Modifiers that leave codemode alone, and an empty modifier list, keep the global choice in charge.
  assert.equal(project(["+grep", "-write"]), undefined);
  assert.equal(project([]), undefined);
  // pi replaces with a malformed value too, and resolves it to no tools at all.
  assert.equal(project("codemode"), "automatic");
  assert.equal(project(null), "automatic");
  // No defaultTools, no file, or one pi reads as empty (unparsable, not an object): the global choice decides.
  assert.equal(projectCodemodePreference(JSON.stringify({ defaultModel: "m" })), undefined);
  assert.equal(projectCodemodePreference(undefined), undefined);
  assert.equal(projectCodemodePreference(""), undefined);
  assert.equal(projectCodemodePreference("{ not json"), undefined);
  assert.equal(projectCodemodePreference("[]"), undefined);
  // A byte-order mark is allowed, as pi allows it.
  assert.equal(projectCodemodePreference(`\ufeff${JSON.stringify({ defaultTools: ["-codemode"] })}`), "automatic");
});

test("a project's settings file is read raw, and anything but a regular file is skipped", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-codemode-project-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const settingsPath = join(cwd, ".pi", "settings.json");
  assert.equal(readProjectCodemodeOverride(cwd), undefined);
  await mkdir(join(cwd, ".pi"));
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["read"] }));
  assert.deepEqual(readProjectCodemodeOverride(cwd), { settingsPath, preference: "automatic" });
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+grep"] }));
  assert.equal(readProjectCodemodeOverride(cwd), undefined);
  // Reading takes no lock, so the project folder gains nothing.
  assert.deepEqual(await readdir(join(cwd, ".pi")), ["settings.json"]);

  await rm(settingsPath);
  await mkdir(settingsPath);
  assert.equal(readProjectCodemodeOverride(cwd), undefined);
  if (process.platform !== "win32") {
    // A FIFO would block the read until something writes to it.
    await rm(settingsPath, { recursive: true });
    execFileSync("mkfifo", [settingsPath]);
    assert.equal(readProjectCodemodeOverride(cwd), undefined);
  }
});
