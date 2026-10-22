import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseTitleModelPreference,
  readTitleModelPreference,
  writeTitleModelPreference,
} = await jiti.import("./title-model-preference.ts");

test("reads a preference out of an object, dropping whatever is not one", () => {
  assert.equal(parseTitleModelPreference(null), null);
  assert.equal(parseTitleModelPreference(undefined), null);
  assert.equal(parseTitleModelPreference("cheap/small"), null);
  assert.equal(parseTitleModelPreference(["cheap", "small"]), null);
  // Nothing to prefer: naming follows the session's own model.
  assert.equal(parseTitleModelPreference({}), null);

  assert.deepEqual(parseTitleModelPreference({ provider: "cheap", modelId: "small" }), {
    provider: "cheap",
    modelId: "small",
  });
  assert.deepEqual(parseTitleModelPreference({ thinkingLevel: "high" }), { thinkingLevel: "high" });
  // A provider without an id is no model, while the level beside it still stands.
  assert.deepEqual(parseTitleModelPreference({ provider: "cheap", thinkingLevel: "high" }), {
    thinkingLevel: "high",
  });
  assert.equal(parseTitleModelPreference({ provider: 5, modelId: "small", thinkingLevel: ["high"] }), null);
  assert.equal(parseTitleModelPreference({ provider: "a".repeat(201), modelId: "small" }), null);
});

test("stores the choice whole, and an empty one as no file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-title-model-"));
  const path = join(dir, "pi-web-title-model.json");
  try {
    // Missing is the default: the session's own model.
    assert.equal(readTitleModelPreference(path), null);

    writeTitleModelPreference({ provider: "cheap", modelId: "small", thinkingLevel: "high" }, path);
    assert.deepEqual(readTitleModelPreference(path), {
      provider: "cheap",
      modelId: "small",
      thinkingLevel: "high",
    });
    assert.equal(JSON.parse(await readFile(path, "utf8")).provider, "cheap");

    writeTitleModelPreference({ thinkingLevel: "medium" }, path);
    assert.deepEqual(readTitleModelPreference(path), { thinkingLevel: "medium" });

    writeTitleModelPreference(null, path);
    assert.equal(existsSync(path), false);
    assert.equal(readTitleModelPreference(path), null);

    // A file this build cannot read is the default, not a failed button.
    await writeFile(path, "not json at all");
    assert.equal(readTitleModelPreference(path), null);
    await writeFile(path, JSON.stringify({ provider: "", modelId: "" }));
    assert.equal(readTitleModelPreference(path), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
