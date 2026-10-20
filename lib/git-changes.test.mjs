import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

async function loadSubject() {
  return import("./git-status.ts");
}

const jiti = createJiti(import.meta.url);
const { getGitStatus } = await jiti.import("./git-changes.ts");
const { TEXT_PREVIEW_MAX_BYTES } = await jiti.import("./file-types.ts");

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

// --- the lines an untracked file holds ---------------------------------------

/** A repository with one committed file, and the real path of the folder. */
function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pi-web-git-lines-")));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "--local", "user.name", "pi-web test");
  git("config", "--local", "user.email", "test@example.invalid");
  fs.writeFileSync(nodePath.join(root, "seed.txt"), "one\n");
  git("add", "--", "seed.txt");
  git("commit", "-qm", "seed");
  return root;
}

test("an untracked file's lines are counted, and counted again once it changes", async (t) => {
  const root = repository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const untracked = nodePath.join(root, "notes.txt");
  fs.writeFileSync(untracked, "one\ntwo\nthree\n");
  assert.equal((await getGitStatus(root)).additions, 3);

  // Quiet long enough to be remembered, so the next scan starts from what the
  // file holds rather than from what it held before.
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  assert.equal((await getGitStatus(root)).additions, 3);

  // The same file, one line more: the count follows the file, not the answer
  // that came before it.
  fs.writeFileSync(untracked, "one\ntwo\nthree\nfour\n");
  assert.equal((await getGitStatus(root)).additions, 4);

  // A last line without a newline is a line of its own.
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  fs.writeFileSync(untracked, "one\ntwo\n");
  assert.equal((await getGitStatus(root)).additions, 2);
});

test("an untracked file that is empty, binary or too large holds no lines", async (t) => {
  const root = repository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(nodePath.join(root, "empty.txt"), "");
  fs.writeFileSync(nodePath.join(root, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));
  fs.writeFileSync(nodePath.join(root, "large.txt"), "x".repeat(TEXT_PREVIEW_MAX_BYTES + 1));

  assert.equal((await getGitStatus(root)).additions, 0);
});

test("a file whose timestamp is put back is counted again all the same", async (t) => {
  const root = repository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const untracked = nodePath.join(root, "notes.txt");
  fs.writeFileSync(untracked, "a\nb");
  // A whole second, so that putting it back later lands on the very same
  // timestamp and not on a nearby one.
  const stamp = Math.floor(Date.now() / 1000) - 10;
  fs.utimesSync(untracked, stamp, stamp);
  // Long enough ago to be remembered by the next scan.
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  assert.equal((await getGitStatus(root)).additions, 2);

  // The file changes, and its modification time is put back where it was. The
  // bytes are the same length and the name the same, so only the file's own
  // change time gives it away — and a program cannot set that back.
  fs.writeFileSync(untracked, "ab\n");
  fs.utimesSync(untracked, stamp, stamp);
  assert.equal(fs.statSync(untracked, { bigint: true }).mtimeNs, BigInt(stamp) * 1_000_000_000n);
  assert.equal((await getGitStatus(root)).additions, 1);
});
