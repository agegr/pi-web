import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const posix = process.platform !== "win32";

async function loadSubject() {
  return import("./git-status.ts");
}

async function loadChanges() {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  return jiti.import("./git-changes.ts");
}

test("empty newly added files do not invent a blank line in the diff", async () => {
  const { getGitFileDiff, getGitStatus } = await loadChanges();
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pi-web-empty-diff-"));
  try {
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    const filePath = nodePath.join(root, "empty.txt");
    fs.writeFileSync(filePath, "");
    assert.equal((await getGitStatus(root)).additions, 0);
    assert.deepEqual(await getGitFileDiff(root, filePath), { supported: false });
    execFileSync("git", ["-C", root, "add", "--", "empty.txt"]);
    assert.deepEqual(await getGitFileDiff(root, filePath), { supported: false });
    fs.writeFileSync(filePath, "\n");
    const blankLine = await getGitFileDiff(root, filePath);
    assert.equal(blankLine.supported, true);
    assert.ok(blankLine.patch.includes("@@ -0,0 +1,1 @@"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

/** A repository with one modified tracked file, and a link that leads to it. */
function linkedRepo() {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pi-web-git-linked-"));
  const real = nodePath.join(root, "real-repo");
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(nodePath.join(real, "a.txt"), "one\n");
  const git = (...args) => execFileSync("git", ["-C", real, ...args], { stdio: "ignore" });
  git("init", "-q");
  for (const [key, value] of [
    ["user.name", "pi-web test"],
    ["user.email", "test@example.invalid"],
    ["core.autocrlf", "false"],
    ["core.fsmonitor", "false"],
  ]) git("config", "--local", key, value);
  git("add", "--", "a.txt");
  git("commit", "-qm", "seed");
  fs.writeFileSync(nodePath.join(real, "a.txt"), "two\n");
  const link = nodePath.join(root, "link-repo");
  fs.symlinkSync(real, link);
  return { root, real, link };
}

test("a repository reached through a link reports files under the folder it was given", async (t) => {
  if (!posix) { t.skip("a symlink of one's own needs privileges on Windows"); return; }
  const { getGitStatus, getGitFileDiff } = await loadChanges();
  const { root, link } = linkedRepo();
  try {
    // What a file listing of that folder hands to a row: the link's own prefix.
    const listed = nodePath.join(link, "a.txt");
    const status = await getGitStatus(link);

    assert.equal(status.isGitRepository, true);
    const entry = status.files.find((file) => file.filePath === listed);
    assert.ok(entry, `a row's path carries its change; listed ${JSON.stringify(status.files.map((file) => file.filePath))}`);
    assert.equal(entry.status, "modified");
    // The line stats follow the folder as well, so the header's counts are this folder's.
    assert.ok(status.additions >= 1, `additions: ${status.additions}`);

    // And the diff route's lookup answers for the same path.
    const diff = await getGitFileDiff(link, listed);
    assert.equal(diff.supported, true);
    assert.ok(diff.patch.includes("+two"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a repository above the folder asked about contributes no rows", async (t) => {
  if (!posix) { t.skip("a symlink of one's own needs privileges on Windows"); return; }
  const { getGitStatus } = await loadChanges();
  const { root, real, link } = linkedRepo();
  try {
    // A subfolder of the work tree still sees the file below it, and nothing above.
    const sub = nodePath.join(real, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(nodePath.join(sub, "b.txt"), "b\n");
    execFileSync("git", ["-C", real, "add", "--", "sub/b.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", real, "commit", "-qm", "sub"], { stdio: "ignore" });
    fs.writeFileSync(nodePath.join(sub, "b.txt"), "b changed\n");

    const inside = await getGitStatus(nodePath.join(link, "sub"));
    assert.deepEqual(inside.files.map((file) => file.filePath), [nodePath.join(link, "sub", "b.txt")]);

    // A folder beside the work tree is not in it: the upward search finds nothing (the
    // temporary folder above is no repository), so there is no view of changes to show.
    const outside = nodePath.join(root, "outside");
    fs.mkdirSync(outside);
    const empty = await getGitStatus(outside);
    assert.equal(empty.isGitRepository, false);
    assert.deepEqual(empty.files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a file outside the linked repository is still refused", async (t) => {
  if (!posix) { t.skip("a symlink of one's own needs privileges on Windows"); return; }
  const { getGitFileDiff } = await loadChanges();
  const { root, link } = linkedRepo();
  try {
    // The link does not widen what may be read: a file that is not in the
    // repository stays out, however it is named.
    const outside = nodePath.join(root, "outside.txt");
    fs.writeFileSync(outside, "not ours\n");
    const diff = await getGitFileDiff(link, outside);
    assert.equal(diff.supported, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A repository with one committed file and the given untracked files (path → content). */
function untrackedRepo(files) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pi-web-git-untracked-"));
  const run = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  run("init", "-q");
  for (const [key, value] of [
    ["user.name", "pi-web test"],
    ["user.email", "test@example.invalid"],
    ["core.autocrlf", "false"],
    ["core.fsmonitor", "false"],
  ]) run("config", "--local", key, value);
  fs.writeFileSync(nodePath.join(root, "tracked.txt"), "one\n");
  run("add", "--", "tracked.txt");
  run("commit", "-qm", "seed");
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(nodePath.dirname(nodePath.join(root, name)), { recursive: true });
    fs.writeFileSync(nodePath.join(root, name), content);
  }
  return root;
}

test("untracked files count their lines as a new-file diff does", async () => {
  const { getGitStatus } = await loadChanges();
  const chunk = 64 * 1024;
  const files = {
    "trailing.txt": "a\nb\n", // 2
    "no-trailing.txt": "a\nb", // 2
    "blank-lines.txt": "\n\n", // 2
    "crlf.txt": "a\r\nb\r\n", // 2
    "empty.txt": "", // 0
    "binary.bin": Buffer.from([0x61, 0x0a, 0x00, 0x62, 0x0a]), // 0
    // Invalid UTF-8 is still text, and its newlines are still newlines.
    "latin1.txt": Buffer.from([0xe9, 0x0a, 0xe2, 0x82, 0x0a, 0xc3]), // 3
    // Past the first chunks read: a NUL there still makes the file binary.
    "late-nul.txt": Buffer.concat([Buffer.from("x\n".repeat(chunk)), Buffer.from([0]), Buffer.from("\n")]), // 0
    // Lines across chunk boundaries, the last one unterminated.
    "chunks.txt": "y\n".repeat(chunk + 3) + "z", // chunk + 4
    "too-big.txt": "x\n".repeat(128 * 1024 + 1), // 0: over the preview's 256 KiB
  };
  // Enough files that several are read at once.
  for (let i = 0; i < 40; i++) files[`many/f${i}.json`] = `{\n  "i": ${i}\n}\n`; // 3 each
  const expected = 2 + 2 + 2 + 2 + 3 + (chunk + 4) + 40 * 3;
  const root = untrackedRepo(files);
  try {
    if (posix) fs.symlinkSync("trailing.txt", nodePath.join(root, "link.txt")); // 0: not a regular file
    fs.writeFileSync(nodePath.join(root, "tracked.txt"), "one\ntwo\n"); // 1 tracked addition
    const status = await getGitStatus(root);
    const untracked = status.files.filter((file) => file.status === "untracked");
    assert.equal(untracked.length, Object.keys(files).length + (posix ? 1 : 0));
    assert.equal(status.additions, expected + 1);
    assert.equal(status.deletions, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("untracked files are read without synchronous file calls (#1584)", async () => {
  // Synchronous reads of tens of thousands of untracked files held the server's
  // event loop, and every stream and request with it, for seconds.
  const { getGitStatus } = await loadChanges();
  const files = {};
  for (let i = 0; i < 20; i++) files[`f${i}.txt`] = `line ${i}\n`;
  const root = untrackedRepo(files);
  const real = fs.realpathSync(root);
  const inRepo = (target) => typeof target === "string"
    && (target.startsWith(`${root}${nodePath.sep}`) || target.startsWith(`${real}${nodePath.sep}`));
  const syncCalls = [];
  const originals = {};
  for (const name of ["lstatSync", "statSync", "openSync", "readFileSync"]) {
    originals[name] = fs[name];
    fs[name] = function (target, ...rest) {
      if (inRepo(target)) syncCalls.push(`${name} ${nodePath.basename(target)}`);
      return originals[name].call(this, target, ...rest);
    };
  }
  try {
    const status = await getGitStatus(root);
    assert.equal(status.additions, 20);
    assert.deepEqual(syncCalls, []);
  } finally {
    Object.assign(fs, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an aborted request stops the untracked scan (#1584)", async () => {
  const { getGitStatus } = await loadChanges();
  const files = {};
  for (let i = 0; i < 20; i++) files[`f${i}.txt`] = `line ${i}\n`;
  const root = untrackedRepo(files);
  const opened = [];
  const originalOpen = fs.promises.open;
  const controller = new AbortController();
  fs.promises.open = async function (target, ...rest) {
    opened.push(target);
    // The client goes away once the first file is being read.
    controller.abort();
    return originalOpen.call(this, target, ...rest);
  };
  try {
    await assert.rejects(getGitStatus(root, controller.signal), { name: "AbortError" });
    // The workers already reading finish their file; none starts another.
    assert.ok(opened.length <= 4, `opened ${opened.length} files`);
  } finally {
    fs.promises.open = originalOpen;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
