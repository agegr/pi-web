import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { loadAgentStripLocked, saveAgentStripLocked } = await jiti.import("./agent-strip-lock.ts");
const { loadMinimapPreviewLocked, saveMinimapPreviewLocked } = await jiti.import("./minimap-preview-lock.ts");

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("the Agents strip starts unlocked, and its lock survives a reload", () => {
  const storage = memoryStorage();
  assert.equal(loadAgentStripLocked(storage), false);
  saveAgentStripLocked(true, storage);
  assert.equal(loadAgentStripLocked(storage), true);
});

test("the strip's lock and the minimap's are separate choices", () => {
  const storage = memoryStorage();
  saveAgentStripLocked(true, storage);
  assert.equal(loadMinimapPreviewLocked(storage), false);
  saveMinimapPreviewLocked(true, storage);
  saveAgentStripLocked(false, storage);
  assert.equal(loadMinimapPreviewLocked(storage), true);
});
