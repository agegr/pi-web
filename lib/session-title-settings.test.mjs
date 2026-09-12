import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  readSessionTitleModel,
  writeSessionTitleModel,
} = await createJiti(import.meta.url).import("./session-title-settings.ts");

test("session title model defaults to inherit when unconfigured", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-title-settings-"));
  const settingsPath = join(root, "settings.json");

  assert.equal(await readSessionTitleModel(settingsPath), "inherit");
});

test("session title model round-trips a configured model and preserves unrelated settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-title-settings-"));
  const settingsPath = join(root, "settings.json");

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "test-model", other: 123 }));
  await writeSessionTitleModel("google/gemini-2.5-flash", settingsPath);

  assert.equal(await readSessionTitleModel(settingsPath), "google/gemini-2.5-flash");
  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(stored.sessionTitleModel, "google/gemini-2.5-flash");
  assert.equal(stored.defaultModel, "test-model");
  assert.equal(stored.other, 123);
});

test("writing inherit removes sessionTitleModel from settings.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-title-settings-"));
  const settingsPath = join(root, "settings.json");

  await writeSessionTitleModel("anthropic/claude-haiku-4-5", settingsPath);
  assert.equal(await readSessionTitleModel(settingsPath), "anthropic/claude-haiku-4-5");

  await writeSessionTitleModel("inherit", settingsPath);
  assert.equal(await readSessionTitleModel(settingsPath), "inherit");
  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal("sessionTitleModel" in stored, false);
});
