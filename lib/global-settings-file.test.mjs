import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { readGlobalSettings, updateGlobalSettings } = await createJiti(import.meta.url, { moduleCache: false })
  .import("./global-settings-file.ts");

async function settingsDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-global-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, settingsPath: join(dir, "settings.json") };
}

function backups(dir) {
  return readdir(dir).then((names) => names.filter((name) => name.startsWith("settings.json.broken-")));
}

test("a settings file that does not parse is preserved as a timestamped backup and reported", async (t) => {
  const { dir, settingsPath } = await settingsDir(t);
  await writeFile(settingsPath, "{ not json");

  await assert.rejects(readGlobalSettings(settingsPath, (settings) => settings), /Invalid settings\.json/);

  const found = await backups(dir);
  assert.equal(found.length, 1);
  assert.match(found[0], /^settings\.json\.broken-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  assert.equal(await readFile(join(dir, found[0]), "utf8"), "{ not json");
  assert.deepEqual(await readdir(dir), found);

  // The original name is free again, so the next read is a fresh, empty configuration.
  assert.deepEqual(await readGlobalSettings(settingsPath, (settings) => settings), {});
  assert.equal((await backups(dir)).length, 1);
});

test("a write against a settings file that does not parse is refused, and its bytes are kept", async (t) => {
  const { dir, settingsPath } = await settingsDir(t);
  await writeFile(settingsPath, "[1, 2]");

  await assert.rejects(
    updateGlobalSettings(settingsPath, (settings) => { settings.defaultTools = ["+codemode"]; }),
    /Invalid settings\.json: expected an object/,
  );
  const found = await backups(dir);
  assert.equal(found.length, 1);
  assert.equal(await readFile(join(dir, found[0]), "utf8"), "[1, 2]");
  assert.deepEqual(await readdir(dir), found);
});

test("a valid settings file is read and written with no backup", async (t) => {
  const { dir, settingsPath } = await settingsDir(t);
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));

  assert.deepEqual(await readGlobalSettings(settingsPath, (settings) => settings), { defaultModel: "m" });
  await updateGlobalSettings(settingsPath, (settings) => { settings.codemode = { mode: "on" }; });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "on" } });
  assert.deepEqual(await readdir(dir), ["settings.json"]);
});

test("a missing settings file reads as empty and is not created", async (t) => {
  const { dir, settingsPath } = await settingsDir(t);

  assert.deepEqual(await readGlobalSettings(settingsPath, (settings) => settings), {});
  assert.deepEqual(await readdir(dir), []);
});
