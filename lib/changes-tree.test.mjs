import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildChangesTree, listChangesDirectoryPaths } = await jiti.import("./changes-tree.ts");

function file(filePath, status = "modified") {
  return {
    filePath,
    status,
    code: status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : status === "untracked" ? "U" : "M",
    indexStatus: " ",
    worktreeStatus: "M",
  };
}

test("builds a nested tree from flat git paths under cwd", () => {
  const tree = buildChangesTree([
    file("/work/app/page.tsx"),
    file("/work/components/FileExplorer.tsx"),
    file("/work/components/FileIcons.tsx"),
    file("/work/lib/sidebar-prefs.ts"),
  ], "/work");

  assert.equal(tree.length, 3);
  assert.equal(tree[0].name, "app");
  assert.equal(tree[0].isDir, true);
  assert.equal(tree[0].children[0].name, "page.tsx");
  assert.equal(tree[0].children[0].status.filePath, "/work/app/page.tsx");

  assert.equal(tree[1].name, "components");
  assert.deepEqual(tree[1].children.map((n) => n.name), ["FileExplorer.tsx", "FileIcons.tsx"]);
  assert.equal(tree[2].name, "lib");
});

test("directories sort before files and siblings are alphabetical", () => {
  const tree = buildChangesTree([
    file("/work/z.ts"),
    file("/work/a/b.ts"),
    file("/work/m.ts"),
  ], "/work");
  assert.deepEqual(tree.map((n) => n.name), ["a", "m.ts", "z.ts"]);
});

test("lists every directory path for default expansion", () => {
  const tree = buildChangesTree([
    file("/work/a/b/c.ts"),
    file("/work/a/d.ts"),
  ], "/work");
  assert.deepEqual(listChangesDirectoryPaths(tree).sort(), ["a", "a/b"]);
});

test("empty input yields an empty tree", () => {
  assert.deepEqual(buildChangesTree([], "/work"), []);
  assert.deepEqual(listChangesDirectoryPaths([]), []);
});

test("paths outside cwd still form a tree from their relative string", () => {
  const tree = buildChangesTree([file("/other/x/y.ts")], "/work");
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, "other");
  assert.equal(tree[0].children[0].name, "x");
  assert.equal(tree[0].children[0].children[0].name, "y.ts");
});
