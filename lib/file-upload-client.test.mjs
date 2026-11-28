import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  collectDroppedItems,
  dropMentionText,
  pickedFolderItems,
  splitDroppedItems,
  summarizeNames,
  uploadTopEntries,
} = await jiti.import("./file-upload-client.ts");

const file = (name, type = "") => new File(["x"], name, { type });

/** A dropped folder entry over a nested object; readEntries answers in batches of two. */
function folderEntry(name, children) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      const entries = Object.entries(children).map(([childName, value]) => (
        value instanceof File
          ? { name: childName, isFile: true, isDirectory: false, file: (resolve) => resolve(value) }
          : folderEntry(childName, value)
      ));
      return {
        readEntries(resolve) {
          resolve(entries.splice(0, 2));
        },
      };
    },
  };
}

test("a chat drop attaches top-level images and uploads other files and folders", () => {
  const photo = file("photo.png", "image/png");
  const notes = file("notes.md", "text/markdown");
  const data = file("data.bin");
  const src = { kind: "folder", name: "src", entry: folderEntry("src", {}) };
  const result = splitDroppedItems([
    { kind: "file", file: photo },
    { kind: "file", file: notes },
    src,
    { kind: "file", file: data },
  ]);
  assert.deepEqual(result.images, [photo]);
  assert.deepEqual(result.uploads, [{ kind: "file", file: notes }, src, { kind: "file", file: data }]);
});

test("a dropped folder is read through every batch and subfolder, leaving dot entries out", async () => {
  const a = file("a.csv");
  const b = file("b.csv");
  const c = file("c.csv");
  const photo = file("photo.png", "image/png");
  const top = file("top.txt");
  const collected = await collectDroppedItems([
    { kind: "file", file: top },
    {
      kind: "folder",
      name: "data",
      entry: folderEntry("data", {
        "a.csv": a,
        ".DS_Store": file(".DS_Store"),
        sub: { "b.csv": b, deeper: { "c.csv": c } },
        ".git": { config: file("config") },
        "photo.png": photo,
      }),
    },
    { kind: "folder", name: "empty", entry: folderEntry("empty", { ".hidden": file(".hidden") }) },
  ]);
  assert.deepEqual(collected.items.map((item) => item.path), [
    "top.txt", "data/a.csv", "data/sub/b.csv", "data/sub/deeper/c.csv", "data/photo.png",
  ]);
  assert.equal(collected.items[3].file, c);
  assert.deepEqual(collected.empty, ["empty"]);
  assert.deepEqual(collected.failed, []);
});

test("a folder that cannot be read is reported, the rest still uploads", async () => {
  const broken = {
    name: "locked", isFile: false, isDirectory: true,
    createReader: () => ({ readEntries: (_resolve, reject) => reject(new Error("NotReadableError")) }),
  };
  const collected = await collectDroppedItems([{ kind: "folder", name: "locked", entry: broken }, { kind: "file", file: file("ok.txt") }]);
  assert.deepEqual(collected.items.map((item) => item.path), ["ok.txt"]);
  assert.deepEqual(collected.failed, [{ name: "locked", error: "NotReadableError" }]);
});

test("a picked folder keeps its relative paths and leaves dot entries inside it out", () => {
  const withPath = (name, relative) => {
    const picked = file(name);
    Object.defineProperty(picked, "webkitRelativePath", { value: relative });
    return picked;
  };
  const items = pickedFolderItems([
    withPath("a.csv", "data/a.csv"),
    withPath(".DS_Store", "data/.DS_Store"),
    withPath("config", "data/.git/config"),
    withPath("b.csv", "data/sub/b.csv"),
  ]);
  assert.deepEqual(items.map((item) => item.path), ["data/a.csv", "data/sub/b.csv"]);
  assert.deepEqual(pickedFolderItems([withPath("x", ".config/x")]).map((item) => item.path), [".config/x"]);
});

test("mentions follow the drop order, name a folder once, and only what is now in the working directory", () => {
  const items = [
    { file: file("b.txt"), path: "b.txt" },
    { file: file("a.csv"), path: "my data/a.csv" },
    { file: file("c.csv"), path: "my data/sub/c.csv" },
    { file: file("failed.log"), path: "failed.log" },
    { file: file("a.txt"), path: "a.txt" },
  ];
  assert.equal(
    dropMentionText(items, ["a.txt", "my data/sub/c.csv", "b.txt"]),
    '@b.txt @"my data/" @a.txt ',
  );
  assert.equal(dropMentionText(items, []), "");
});

test("an upload's top entries are its files and the folders holding the rest", () => {
  assert.deepEqual(uploadTopEntries(["data/a.csv", "notes.md", "data/sub/b.csv"]), [
    { path: "data", isDir: true },
    { path: "notes.md", isDir: false },
  ]);
});

test("a notice names a few paths and counts the rest", () => {
  const more = (count) => `+${count} more`;
  assert.equal(summarizeNames(["a", "b"], more), "a, b");
  assert.equal(summarizeNames(["a", "b", "c", "d", "e", "f", "g"], more), "a, b, c, d, e +2 more");
});
