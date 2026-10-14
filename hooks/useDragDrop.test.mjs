import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { droppedItems } = await jiti.import("./useDragDrop.ts");

const file = (name) => new File(["x"], name);

/** A drop's DataTransfer as Chrome hands it over: a folder comes as an entry and a File of its own. */
function dataTransfer(entries) {
  return {
    items: entries.map(({ name, folder }) => ({
      kind: "file",
      webkitGetAsEntry: () => ({ name, isDirectory: folder === true }),
      getAsFile: () => file(name),
    })),
    files: entries.map(({ name }) => file(name)),
  };
}

test("a dropped folder is told apart from the files beside it", () => {
  const items = droppedItems(dataTransfer([{ name: "notes.md" }, { name: "src", folder: true }, { name: "data.bin" }]));
  assert.deepEqual(items.map((item) => (item.kind === "folder" ? `folder:${item.name}` : `file:${item.file.name}`)), [
    "file:notes.md",
    "folder:src",
    "file:data.bin",
  ]);
});

test("without item entries the drop falls back to its file list", () => {
  const items = droppedItems({ items: [], files: [file("a.txt")] });
  assert.deepEqual(items.map((item) => item.kind === "file" && item.file.name), ["a.txt"]);
});
