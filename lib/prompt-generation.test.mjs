import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { nextPromptGeneration, getPromptGeneration } = await jiti.import("./prompt-generation.ts");

test("prompt generations increment per session and stay isolated", () => {
  const previous = globalThis.__piPromptGenerations;
  globalThis.__piPromptGenerations = new Map();
  try {
    assert.equal(getPromptGeneration("s1"), 0);
    assert.equal(nextPromptGeneration("s1"), 1);
    assert.equal(nextPromptGeneration("s1"), 2);
    assert.equal(nextPromptGeneration("s2"), 1);
    assert.equal(getPromptGeneration("s1"), 2);
    assert.equal(getPromptGeneration("s2"), 1);
  } finally {
    globalThis.__piPromptGenerations = previous;
  }
});
