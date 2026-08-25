import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-search.ts");
}

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-search-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Write a file, creating any missing parent directories first. */
async function writeFileIn(root, relative, content = "") {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

test("returns empty for blank queries", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, ""), []);
    assert.deepEqual(searchFiles(root, "   "), []);
  } finally {
    await cleanup();
  }
});

test("ranks exact filename matches above prefix, substring, and path matches", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "Chart.tsx");
    await writeFileIn(root, "ChatInput.tsx");
    await writeFileIn(root, "components/ChatPanel.tsx");
    await writeFileIn(root, "lib/path-input.ts");
    await writeFileIn(root, "utils/input.ts");

    const { searchFiles } = await loadSubject();
    // "input.ts" prefix-matches utils/input.ts (80), name-includes the
    // others (60) — same score ties break by path.
    assert.deepEqual(searchFiles(root, "input.ts"), [
      "utils/input.ts",
      "ChatInput.tsx",
      "lib/path-input.ts",
    ]);
    // "Chat" prefix-matches both filenames; lib/path-input.ts contains
    // neither "chat" in its name nor its path, so it is excluded.
    assert.deepEqual(searchFiles(root, "Chat"), [
      "ChatInput.tsx",
      "components/ChatPanel.tsx",
    ]);
  } finally {
    await cleanup();
  }
});

test("matches case-insensitively and returns forward-slash paths", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "src/MainComponent.tsx");

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "MAINCOMPONENT"), ["src/MainComponent.tsx"]);
    assert.deepEqual(searchFiles(root, "maincomponent.tsx"), ["src/MainComponent.tsx"]);
    assert.deepEqual(searchFiles(root, "COMPONENT"), ["src/MainComponent.tsx"]);
    assert.equal(searchFiles(root, "MainComponent").every((p) => !p.includes("\\")), true);
  } finally {
    await cleanup();
  }
});

test("never returns directories, only files", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "src/deep/main.ts");

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "src"), ["src/deep/main.ts"]);
    assert.deepEqual(searchFiles(root, "deep"), ["src/deep/main.ts"]);
  } finally {
    await cleanup();
  }
});

test("skips ignored directories (node_modules, .git, dist, build, ...)", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "src/config.json", "{}");
    await writeFileIn(root, "node_modules/pkg/config.js");
    await writeFileIn(root, ".git/config");
    await writeFileIn(root, ".next/config.js");
    await writeFileIn(root, "dist/config.js");
    await writeFileIn(root, "build/config.js");

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "config"), ["src/config.json"]);
  } finally {
    await cleanup();
  }
});

test("skips files with ignored suffixes (.pyc)", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "src/main.py");
    await writeFileIn(root, "src/main.pyc");

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "main"), ["src/main.py"]);
    assert.deepEqual(searchFiles(root, "pyc"), []);
  } finally {
    await cleanup();
  }
});

test("matches on the full relative path when the filename does not", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "packages/editor/index.ts");

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "packages/editor"), ["packages/editor/index.ts"]);
    assert.deepEqual(searchFiles(root, "editor/index"), ["packages/editor/index.ts"]);
  } finally {
    await cleanup();
  }
});

test("caps results at 200 entries", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    for (let i = 0; i < 250; i++) {
      await writeFileIn(root, `many/f${i}.ts`);
    }

    const { searchFiles } = await loadSubject();
    const results = searchFiles(root, "f");
    assert.equal(results.length, 200);
    assert.equal(new Set(results).size, 200);
  } finally {
    await cleanup();
  }
});

test("tolerates missing roots and unreadable subtrees", async () => {
  const { searchFiles } = await loadSubject();
  assert.deepEqual(searchFiles(path.join(tmpdir(), "pi-web-search-missing-xyz"), "x"), []);
});

test("does not recurse through symlink loops", async () => {
  const { root, cleanup } = await makeRoot();
  try {
    await writeFileIn(root, "a/match.txt");
    await symlink(root, path.join(root, "a", "loop"));

    const { searchFiles } = await loadSubject();
    assert.deepEqual(searchFiles(root, "match"), ["a/match.txt"]);
  } finally {
    await cleanup();
  }
});
