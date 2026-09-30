import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Keep the machine's git configuration out of the answers: a global excludes
// file could ignore the very names these tests expect to see, and a repository
// above the temp directory could claim the "non-Git" fixtures.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-tree-visibility-")));
fs.writeFileSync(path.join(root, "gitconfig"), "");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = path.join(root, "gitconfig");
process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
process.env.GIT_CEILING_DIRECTORIES = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { getFileTreeVisibility, isHiddenOutsideGit } = await import("./file-tree-visibility.ts");

let fixtureCount = 0;
function fixture(files) {
  const dir = path.join(root, `fixture-${++fixtureCount}`);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function repo(files, tracked = []) {
  const dir = fixture(files);
  git(dir, "init", "-q");
  if (tracked.length > 0) git(dir, "add", "-f", "--", ...tracked);
  return dir;
}

async function visibleNames(dir) {
  const names = fs.readdirSync(dir);
  const isVisible = await getFileTreeVisibility(dir, names);
  return names.filter(isVisible).sort();
}

test("a Git work tree shows tracked directories the name list would hide", async () => {
  const dir = repo({
    "build/index.js": "",
    "dist/app.js": "",
    "src/main.ts": "",
  }, ["build/index.js", "dist/app.js", "src/main.ts"]);

  assert.deepEqual(await visibleNames(dir), ["build", "dist", "src"]);
});

test("a Git work tree hides what the repository ignores, whatever its name", async () => {
  const dir = repo({
    ".gitignore": "build/\n*.log\ngenerated/\n",
    "build/index.js": "",
    "generated/types.ts": "",
    "debug.log": "",
    "release.log": "",
    "src/main.ts": "",
  }, [".gitignore", "release.log", "src/main.ts"]);

  // A force-added file stays visible under a matching pattern, as in `git status`.
  assert.deepEqual(await visibleNames(dir), [".gitignore", "release.log", "src"]);
});

test("a Git work tree shows untracked entries it does not ignore", async () => {
  const dir = repo({
    ".gitignore": "*.tmp\n",
    "notes/todo.md": "",
    "vendor/lib.js": "",
    "coverage/lcov.info": "",
    "scratch.tmp": "",
  });

  assert.deepEqual(await visibleNames(dir), [".gitignore", "coverage", "notes", "vendor"]);
});

test("an ignored directory holding a tracked file is shown with only its tracked entries", async () => {
  const dir = repo({
    ".gitignore": "out/\n",
    "out/keep.txt": "",
    "out/stale.txt": "",
  }, [".gitignore", "out/keep.txt"]);

  assert.deepEqual(await visibleNames(dir), [".gitignore", "out"]);
  assert.deepEqual(await visibleNames(path.join(dir, "out")), ["keep.txt"]);
});

test(".git and .DS_Store are hidden in a work tree even when nothing else is", async () => {
  const dir = repo({ "README.md": "", ".DS_Store": "" });
  assert.ok(fs.existsSync(path.join(dir, ".git")));

  assert.deepEqual(await visibleNames(dir), ["README.md"]);
});

test("a directory outside any work tree falls back to the name list", async () => {
  const dir = fixture({
    "build/index.js": "",
    "node_modules/pkg/index.js": "",
    "cache.pyc": "",
    "src/main.ts": "",
  });

  assert.deepEqual(await visibleNames(dir), ["src"]);
});

test("a directory the repository ignores falls back to the name list instead of listing empty", async () => {
  // Dotfile repositories ignore `*` and force-add what they track.
  const dir = repo({
    ".gitignore": "*\n",
    ".bashrc": "",
    "project/build/index.js": "",
    "project/src/main.ts": "",
  }, [".gitignore", ".bashrc"]);

  assert.deepEqual(await visibleNames(dir), [".bashrc", ".gitignore"]);
  assert.deepEqual(await visibleNames(path.join(dir, "project")), ["src"]);
});

test("a nested repository answers for its own entries", async () => {
  const outer = repo({ ".gitignore": "build/\n", "inner/build/index.js": "", "inner/out/a.js": "" }, [".gitignore"]);
  const inner = path.join(outer, "inner");
  git(inner, "init", "-q");
  fs.writeFileSync(path.join(inner, ".gitignore"), "out/\n");

  assert.deepEqual(await visibleNames(outer), [".gitignore", "inner"]);
  assert.deepEqual(await visibleNames(inner), [".gitignore", "build"]);
});

test("names are passed to git as literal paths", { skip: process.platform === "win32" }, async () => {
  // A leading `:(` is pathspec magic, which check-ignore rejects for the whole
  // batch. The tracked build/ proves the answer came from Git, not the fallback.
  const dir = repo({
    ".gitignore": "*.tmp\n",
    ":(glob)x.tmp": "",
    ":!y.txt": "",
    "[id]/page.tsx": "",
    "build/index.js": "",
  }, [".gitignore", "[id]/page.tsx", "build/index.js"]);

  assert.deepEqual(await visibleNames(dir), [".gitignore", ":!y.txt", "[id]", "build"]);
});

test("an ignored name is not un-ignored by a tracked name its glob characters match", { skip: process.platform === "win32" }, async () => {
  // Checked against the index, `*.log` and `[id]` would match the tracked
  // `app.log` and `i` as pathspec globs and show up although Git ignores them.
  const dir = repo({
    ".gitignore": "*.log\n[[]id]/\n",
    "*.log": "",
    "app.log": "",
    "[id]/page.tsx": "",
    "i": "",
  }, [".gitignore", "app.log", "i"]);

  assert.deepEqual(await visibleNames(dir), [".gitignore", "app.log", "i"]);
});

test("listing a directory does not run the repository's fsmonitor hook", { skip: process.platform === "win32" }, async () => {
  const dir = repo({ "build/index.js": "" }, ["build/index.js"]);
  const marker = path.join(root, "fsmonitor-ran");
  const hook = path.join(root, "fsmonitor-hook.sh");
  fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  git(dir, "config", "core.fsmonitor", hook);

  assert.deepEqual(await visibleNames(dir), ["build"]);
  assert.equal(fs.existsSync(marker), false);
});

test("a missing git falls back to the name list", async (t) => {
  const dir = repo({ "build/index.js": "", "src/main.ts": "" }, ["build/index.js", "src/main.ts"]);
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = path.join(root, "no-git-here");

  assert.deepEqual(await visibleNames(dir), ["src"]);
});

test("the fallback name list matches names and generated suffixes", () => {
  for (const name of ["node_modules", ".git", "build", "dist", ".DS_Store", "module.pyc"]) {
    assert.equal(isHiddenOutsideGit(name), true, name);
  }
  for (const name of ["src", "builds", ".github", "pyc"]) {
    assert.equal(isHiddenOutsideGit(name), false, name);
  }
});
