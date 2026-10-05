import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  parseModelNotes,
  resolveModelNote,
  loadModelNotes,
  modelNoteKey,
  MODEL_NOTES_FILENAME,
} = await createJiti(import.meta.url).import("./model-notes.ts");

test("string notes are parsed", () => {
  const notes = parseModelNotes({ "ark/glm-5.3": "综合强", "kimi-k3": "长上下文" });
  assert.equal(notes.get("ark/glm-5.3"), "综合强");
  assert.equal(notes.get("kimi-k3"), "长上下文");
});

test("object notes are accepted via note or text", () => {
  const notes = parseModelNotes({
    "a/b": { note: "via note" },
    "c/d": { text: "via text" },
  });
  assert.equal(notes.get("a/b"), "via note");
  assert.equal(notes.get("c/d"), "via text");
});

test("junk entries are dropped, never thrown", () => {
  const notes = parseModelNotes({
    "": "empty key",
    "blank": "   ",
    "num": 42,
    "arr": [1, 2],
    "obj": { other: "x" },
    "good": "kept",
  });
  assert.deepEqual([...notes.keys()], ["good"]);
});

test("non-object input yields an empty map", () => {
  for (const value of [null, undefined, [], "text", 7]) {
    assert.equal(parseModelNotes(value).size, 0);
  }
});

test("provider/model wins over a bare model fallback", () => {
  const notes = parseModelNotes({
    "kimi-k3": "any provider",
    "ark/kimi-k3": "ark specific",
  });
  assert.equal(resolveModelNote(notes, "ark", "kimi-k3"), "ark specific");
  assert.equal(resolveModelNote(notes, "other", "kimi-k3"), "any provider");
  assert.equal(resolveModelNote(notes, "ark", "missing"), undefined);
});

test("modelNoteKey joins provider and id", () => {
  assert.equal(modelNoteKey("ark", "glm-5.3"), "ark/glm-5.3");
});

test("loadModelNotes reads the agent dir and tolerates problems", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notes-"));
  try {
    writeFileSync(join(dir, MODEL_NOTES_FILENAME), JSON.stringify({ "ark/glm-5.3": "note" }));
    assert.equal(loadModelNotes(dir).get("ark/glm-5.3"), "note");

    // Missing file
    const empty = mkdtempSync(join(tmpdir(), "pi-notes-empty-"));
    try {
      assert.equal(loadModelNotes(empty).size, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    // Malformed JSON must not throw
    writeFileSync(join(dir, MODEL_NOTES_FILENAME), "{ not json");
    assert.equal(loadModelNotes(dir).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
