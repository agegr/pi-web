import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  PiWebSettingsLockedError,
  getPiWebSettingsPath,
  readPiWebSettings,
  resetPiWebSettingsCacheForTests,
  updatePiWebSettings,
} = await jiti.import("./pi-web-settings.ts");
const { DEFAULT_PI_WEB_SETTINGS } = await jiti.import("./pi-web-settings-shared.ts");

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-settings-"));
  const agentDir = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetPiWebSettingsCacheForTests();
  t.after(() => {
    resetPiWebSettingsCacheForTests();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const path = join(agentDir, "pi-web-settings.json");
  return {
    agentDir,
    path,
    readFile: () => JSON.parse(fs.readFileSync(path, "utf8")),
    write: (value) => {
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    },
  };
}

function quietWarnings(t) {
  const warnings = [];
  const previous = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => { console.warn = previous; });
  return warnings;
}

test("the file sits beside the session UI state", (t) => {
  const { agentDir } = fixture(t);
  assert.equal(getPiWebSettingsPath(), join(agentDir, "pi-web-settings.json"));
});

test("no file reads as the defaults and nothing is created", (t) => {
  const { path } = fixture(t);
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS });
  assert.equal(fs.existsSync(path), false, "a read never writes");
});

test("a write stores the one setting and leaves the defaults out", async (t) => {
  const { readFile } = fixture(t);
  assert.deepEqual(await updatePiWebSettings({ thinkingExpandedDefault: true }), {
    ...DEFAULT_PI_WEB_SETTINGS,
    thinkingExpandedDefault: true,
  });
  assert.deepEqual(readFile(), { version: 1, thinkingExpandedDefault: true });
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS, thinkingExpandedDefault: true });

  // Back to the default: the key goes, and the file holds the version alone.
  await updatePiWebSettings({ thinkingExpandedDefault: false });
  assert.deepEqual(readFile(), { version: 1 });
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS });
});

test("a patch keeps the other settings, and a write that changes nothing leaves the file alone", async (t) => {
  const { path, readFile } = fixture(t);
  await updatePiWebSettings({ quoteSelection: true });
  await updatePiWebSettings({ enterSendMode: "ctrlEnter" });
  assert.deepEqual(readFile(), { version: 1, quoteSelection: true, enterSendMode: "ctrlEnter" });

  const before = fs.statSync(path);
  await updatePiWebSettings({ enterSendMode: "ctrlEnter" });
  const after = fs.statSync(path);
  assert.equal(after.ino, before.ino, "no write at all");
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("unknown fields of a valid file are kept", async (t) => {
  const { readFile, write } = fixture(t);
  write({ version: 1, quoteSelection: true, fromANewerBuild: { a: 1 } });
  await updatePiWebSettings({ thinkingExpandedDefault: true });
  assert.deepEqual(readFile(), { version: 1, quoteSelection: true, thinkingExpandedDefault: true, fromANewerBuild: { a: 1 } });
});

test("a corrupt file is read as the defaults, then set aside on the next write", async (t) => {
  const { agentDir, readFile, write } = fixture(t);
  const warnings = quietWarnings(t);
  write("{ not json");
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS });

  await updatePiWebSettings({ quoteSelection: true });
  assert.deepEqual(readFile(), { version: 1, quoteSelection: true });
  const backups = fs.readdirSync(agentDir).filter((name) => name.startsWith("pi-web-settings.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(join(agentDir, backups[0]), "utf8"), "{ not json");
  assert.ok(warnings.some((line) => line.includes("is not valid pi-web settings")));
});

test("a file of another version is set aside too, never merged", async (t) => {
  const { readFile, write } = fixture(t);
  quietWarnings(t);
  write({ version: 2, quoteSelection: true });
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS });
  await updatePiWebSettings({ enterSendMode: "ctrlEnter" });
  assert.deepEqual(readFile(), { version: 1, enterSendMode: "ctrlEnter" });
});

test("concurrent writes are applied one after the other, each keeping the other's key", async (t) => {
  const { readFile } = fixture(t);
  await Promise.all([
    updatePiWebSettings({ thinkingExpandedDefault: true }),
    updatePiWebSettings({ quoteSelection: true }),
    updatePiWebSettings({ enterSendMode: "ctrlEnter" }),
  ]);
  assert.deepEqual(readFile(), { version: 1, thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" });
  assert.deepEqual(readPiWebSettings(), { thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" });
});

test("a lock another process holds is reported", async (t) => {
  const { path, write } = fixture(t);
  write({ version: 1 });
  // proper-lockfile's own lock file, as another pi-web process would leave it.
  fs.writeFileSync(`${path}.lock`, "");
  await assert.rejects(updatePiWebSettings({ quoteSelection: true }), PiWebSettingsLockedError);
  fs.rmSync(`${path}.lock`, { force: true });
});

test("a read of a directory (not a regular file) is the defaults, never a throw", (t) => {
  const { path } = fixture(t);
  fs.mkdirSync(path, { recursive: true });
  quietWarnings(t);
  assert.deepEqual(readPiWebSettings(), { ...DEFAULT_PI_WEB_SETTINGS });
});
