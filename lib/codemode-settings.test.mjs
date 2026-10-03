import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  CODEMODE_INLINE_BUDGET_DEFAULT,
  codemodeInlineBudgetOf,
  codemodeModeOf,
  codemodePreferenceOf,
  isCodemodeInlineBudget,
  isCodemodeMode,
  projectCodemodeInlineBudget,
  projectCodemodeMode,
  projectCodemodePreference,
  readCodemodePreference,
  readCodemodeSettings,
  readProjectCodemodeInlineBudget,
  readProjectCodemodeMode,
  readProjectCodemodeOverride,
  withCodemodePreference,
  writeCodemodeInlineBudget,
  writeCodemodeMode,
  writeCodemodePreference,
} = await jiti.import("./codemode-settings.ts");
const readCodemodeInlineBudget = async (settingsPath) => (await readCodemodeSettings(settingsPath)).inlineBudget;
const readCodemodeMode = async (settingsPath) => (await readCodemodeSettings(settingsPath)).mode;
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

test("the default inline budget is the SDK's", async () => {
  // The SDK root does not export it; the codemode tool's module does.
  const tool = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js", import.meta.url).href);
  assert.equal(CODEMODE_INLINE_BUDGET_DEFAULT, tool.DEFAULT_CODEMODE_INLINE_BUDGET);
});

test("the inline budget is read as the codemode extension reads it", () => {
  assert.deepEqual(codemodeInlineBudgetOf({}), {});
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { mode: "only" } }), {});
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { inlineBudget: 0 } }), { value: 0 });
  // pi takes any finite number of 0 or more, fractions included.
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { inlineBudget: 1500.5 } }), { value: 1500.5 });
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { inlineBudget: -1 } }), { invalid: "-1" });
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { inlineBudget: "3000" } }), { invalid: '"3000"' });
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: { inlineBudget: null } }), { invalid: "null" });
  assert.equal(codemodeInlineBudgetOf({ codemode: { inlineBudget: "x".repeat(100) } }).invalid.length, 60);
  // A codemode that is not an object holds no budget.
  assert.deepEqual(codemodeInlineBudgetOf({ codemode: "on" }), {});

  // Settings saves only whole numbers within its limit.
  for (const value of [0, 3000, 1_000_000]) assert.equal(isCodemodeInlineBudget(value), true, String(value));
  for (const value of [-1, 1.5, 1_000_001, "3000", null, Number.NaN, Infinity]) assert.equal(isCodemodeInlineBudget(value), false, String(value));
});

test("writing the inline budget keeps codemode.mode and other settings, and empties nothing it did not fill", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  assert.deepEqual(await readCodemodeInlineBudget(settingsPath), {});
  assert.deepEqual(await writeCodemodeInlineBudget(undefined, settingsPath), {});
  await assert.rejects(stat(settingsPath), { code: "ENOENT" }, "the default needs no file");

  assert.deepEqual(await writeCodemodeInlineBudget(1000, settingsPath), { value: 1000 });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { codemode: { inlineBudget: 1000 } });
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", codemode: { mode: "only", inlineBudget: 1000 } }));
  const compact = await readFile(settingsPath, "utf8");
  assert.deepEqual(await writeCodemodeInlineBudget(1000, settingsPath), { value: 1000 });
  assert.equal(await readFile(settingsPath, "utf8"), compact, "an unchanged budget is not rewritten");

  assert.deepEqual(await writeCodemodeInlineBudget(0, settingsPath), { value: 0 });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "only", inlineBudget: 0 } });
  // Back to the default: the key goes, codemode.mode stays.
  assert.deepEqual(await writeCodemodeInlineBudget(undefined, settingsPath), {});
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "only" } });
  // A codemode object the budget alone filled goes with it.
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", codemode: { inlineBudget: 500 } }));
  await writeCodemodeInlineBudget(undefined, settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });

  // A value pi ignores is reported, and the default removes it.
  await writeFile(settingsPath, JSON.stringify({ codemode: { inlineBudget: "lots" } }));
  assert.deepEqual(await readCodemodeInlineBudget(settingsPath), { invalid: '"lots"' });
  assert.deepEqual(await writeCodemodeInlineBudget(undefined, settingsPath), {});
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});

  // A codemode that is not an object is refused rather than replaced; the default needs no write there.
  await writeFile(settingsPath, JSON.stringify({ codemode: "on" }));
  await assert.rejects(writeCodemodeInlineBudget(1000, settingsPath), /codemode must be an object/);
  assert.deepEqual(await writeCodemodeInlineBudget(undefined, settingsPath), {});
  assert.equal(await readFile(settingsPath, "utf8"), JSON.stringify({ codemode: "on" }));
  // A file that does not parse is left alone.
  await writeFile(settingsPath, "{ not json");
  await assert.rejects(writeCodemodeInlineBudget(1000, settingsPath), SyntaxError);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
});

test("a project's settings decide the inline budget only where they replace the global one", () => {
  const project = (settings) => projectCodemodeInlineBudget(JSON.stringify(settings));
  assert.deepEqual(project({ codemode: { inlineBudget: 800 } }), { value: 800 });
  assert.deepEqual(project({ codemode: { inlineBudget: 0, mode: "only" } }), { value: 0 });
  // pi merges a value it then ignores, so sessions get the default.
  assert.deepEqual(project({ codemode: { inlineBudget: null } }), { invalid: "null" });
  // A codemode that is not an object replaces the global one and leaves no budget at all.
  assert.deepEqual(project({ codemode: "on" }), {});
  // Other codemode keys, no codemode, or a file pi reads as empty keep the global budget in charge.
  assert.equal(project({ codemode: { mode: "only" } }), undefined);
  assert.equal(project({ defaultModel: "m" }), undefined);
  assert.equal(projectCodemodeInlineBudget(undefined), undefined);
  assert.equal(projectCodemodeInlineBudget("{ not json"), undefined);
});

test("a project's inline budget is read from its settings file", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-codemode-budget-project-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const settingsPath = join(cwd, ".pi", "settings.json");
  assert.equal(readProjectCodemodeInlineBudget(cwd), undefined);
  await mkdir(join(cwd, ".pi"));
  await writeFile(settingsPath, JSON.stringify({ codemode: { inlineBudget: 800 } }));
  assert.deepEqual(readProjectCodemodeInlineBudget(cwd), { settingsPath, value: 800 });
  await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "on" } }));
  assert.equal(readProjectCodemodeInlineBudget(cwd), undefined);
});

test("the mode is read as the codemode extension reads it", async () => {
  assert.deepEqual(codemodeModeOf({}), { value: "on" });
  assert.deepEqual(codemodeModeOf({ codemode: { inlineBudget: 800 } }), { value: "on" });
  assert.deepEqual(codemodeModeOf({ codemode: { mode: "on" } }), { value: "on" });
  assert.deepEqual(codemodeModeOf({ codemode: { mode: "only" } }), { value: "only" });
  // Anything but "only" is "on" to pi; a value that is neither mode is reported.
  assert.deepEqual(codemodeModeOf({ codemode: { mode: "ONLY" } }), { value: "on", invalid: '"ONLY"' });
  assert.deepEqual(codemodeModeOf({ codemode: { mode: true } }), { value: "on", invalid: "true" });
  assert.deepEqual(codemodeModeOf({ codemode: { mode: null } }), { value: "on", invalid: "null" });
  // A codemode that is not an object holds no mode.
  assert.deepEqual(codemodeModeOf({ codemode: "only" }), { value: "on" });

  for (const value of ["on", "only"]) assert.equal(isCodemodeMode(value), true, value);
  for (const value of ["off", "ONLY", "", null, true]) assert.equal(isCodemodeMode(value), false, String(value));

  // The extension's own reader agrees: the SDK root does not export it, the module's factory reads it.
  const { createCodemodeExtension } = await import(
    new URL("../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js", import.meta.url).href
  );
  for (const codemode of [undefined, { mode: "only" }, { mode: "on" }, { mode: "ONLY" }, { mode: null }, "only"]) {
    let definition;
    createCodemodeExtension()({
      registerTool: (tool) => { definition = tool; },
      getSettings: () => (codemode === undefined ? {} : { codemode }),
      getAllTools: () => [],
      appendEntry() {},
    });
    const direct = { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } };
    const loadout = {
      declared: [direct],
      callable: [direct],
      registered: [direct],
      getExposure: () => "direct",
      getNamespace: () => undefined,
    };
    const hidden = definition.prepareLoadout(loadout).hiddenDeclarations;
    const expected = codemodeModeOf(codemode === undefined ? {} : { codemode }).value;
    assert.deepEqual(hidden, expected === "only" ? ["read"] : [], JSON.stringify(codemode));
  }
});

test("writing the mode keeps codemode.inlineBudget and other settings, and \"on\" removes what only it filled", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-mode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  assert.deepEqual(await readCodemodeMode(settingsPath), { value: "on" });
  assert.deepEqual(await writeCodemodeMode("on", settingsPath), { value: "on" });
  await assert.rejects(stat(settingsPath), { code: "ENOENT" }, "the default needs no file");

  assert.deepEqual(await writeCodemodeMode("only", settingsPath), { value: "only" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { codemode: { mode: "only" } });
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", codemode: { mode: "only", inlineBudget: 1000 } }));
  const compact = await readFile(settingsPath, "utf8");
  assert.deepEqual(await writeCodemodeMode("only", settingsPath), { value: "only" });
  assert.equal(await readFile(settingsPath, "utf8"), compact, "an unchanged mode is not rewritten");
  // Back to "on": the key goes, the budget stays.
  assert.deepEqual(await writeCodemodeMode("on", settingsPath), { value: "on" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { inlineBudget: 1000 } });
  // A codemode object the mode alone filled goes with it.
  await writeCodemodeMode("only", settingsPath);
  await writeCodemodeInlineBudget(undefined, settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "only" } });
  await writeCodemodeMode("on", settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });

  // An explicit "on" already gives "on" and is left as written.
  await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "on" } }));
  const explicit = await readFile(settingsPath, "utf8");
  assert.deepEqual(await writeCodemodeMode("on", settingsPath), { value: "on" });
  assert.equal(await readFile(settingsPath, "utf8"), explicit);
  // A value that is neither mode is reported, and either mode replaces it.
  await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "ONLY" } }));
  assert.deepEqual(await readCodemodeMode(settingsPath), { value: "on", invalid: '"ONLY"' });
  assert.deepEqual(await writeCodemodeMode("on", settingsPath), { value: "on" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});

  // A codemode that is not an object is refused rather than replaced; "on" needs no write there.
  await writeFile(settingsPath, JSON.stringify({ codemode: "only" }));
  await assert.rejects(writeCodemodeMode("only", settingsPath), /codemode must be an object/);
  assert.deepEqual(await writeCodemodeMode("on", settingsPath), { value: "on" });
  assert.equal(await readFile(settingsPath, "utf8"), JSON.stringify({ codemode: "only" }));
  // A file that does not parse is left alone.
  await writeFile(settingsPath, "{ not json");
  await assert.rejects(writeCodemodeMode("only", settingsPath), SyntaxError);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
});

test("a project's settings decide the mode only where they replace the global one", () => {
  const project = (settings) => projectCodemodeMode(JSON.stringify(settings));
  assert.deepEqual(project({ codemode: { mode: "only" } }), { value: "only" });
  assert.deepEqual(project({ codemode: { mode: "on", inlineBudget: 0 } }), { value: "on" });
  // pi merges a value it then reads as "on".
  assert.deepEqual(project({ codemode: { mode: "never" } }), { value: "on", invalid: '"never"' });
  // A codemode that is not an object replaces the global one and leaves no mode, which is "on".
  assert.deepEqual(project({ codemode: "only" }), { value: "on" });
  // Other codemode keys, no codemode, or a file pi reads as empty keep the global mode in charge.
  assert.equal(project({ codemode: { inlineBudget: 800 } }), undefined);
  assert.equal(project({ defaultModel: "m" }), undefined);
  assert.equal(projectCodemodeMode(undefined), undefined);
  assert.equal(projectCodemodeMode("{ not json"), undefined);
});

test("a project's mode is read from its settings file", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-codemode-mode-project-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const settingsPath = join(cwd, ".pi", "settings.json");
  assert.equal(readProjectCodemodeMode(cwd), undefined);
  await mkdir(join(cwd, ".pi"));
  await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "only" } }));
  assert.deepEqual(readProjectCodemodeMode(cwd), { settingsPath, value: "only" });
  await writeFile(settingsPath, JSON.stringify({ codemode: { inlineBudget: 800 } }));
  assert.equal(readProjectCodemodeMode(cwd), undefined);
});
