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
