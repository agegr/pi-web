import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-diff-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet");
  allowFileRoot(root);
  return root;
}

function request(cwd, filePath) {
  const url = new URL("http://localhost/api/git/diff");
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("path", filePath);
  return GET(new NextRequest(url));
}

function directoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

test("preserves trailing spaces in Git file and directory paths", { skip: process.platform === "win32" }, async () => {
  const root = path.join(fixture(), "working tree ");
  fs.mkdirSync(root);
  git(root, "init", "--quiet");
  const filePath = path.join(root, "notes.txt ");
  fs.writeFileSync(filePath, "space-suffixed file\n");
  const response = await request(root, filePath);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.supported, true);
  assert.ok(result.patch.includes("+space-suffixed file"));

  const { GET: getStatus } = await jiti.import("../status/route.ts");
  const url = new URL("http://localhost/api/git/status");
  url.searchParams.set("cwd", root);
  const statusResponse = await getStatus(new NextRequest(url));
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.ok(status.files.some((file) => file.filePath === filePath));
});

test("refuses a file reached through an outside junction before returning any content", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside-secret-marker\n");
  directoryLink(outside, path.join(root, "linked"));
  const response = await request(root, path.join(root, "linked", "secret.txt"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("refuses missing descendants of an outside or dangling junction", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "missing-outside-"));
  directoryLink(outside, path.join(root, "linked"));
  const filePath = path.join(root, "linked", "missing-parent", "missing.txt");
  assert.equal((await request(root, filePath)).status, 403);
  fs.rmdirSync(outside);
  assert.equal((await request(root, filePath)).status, 403);
});

test("allows a Windows junction after its target is explicitly allowed", { skip: process.platform !== "win32" }, async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "allowed-outside-"));
  fs.writeFileSync(path.join(outside, "notes.txt"), "explicitly allowed text\n");
  directoryLink(outside, path.join(root, "linked"));
  const filePath = path.join(root, "linked", "notes.txt");
  assert.equal((await request(root, filePath)).status, 403);
  allowFileRoot(outside);
  const response = await request(root, filePath);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.supported, true);
  assert.equal(result.status, "untracked");
  assert.ok(result.patch.includes("+explicitly allowed text"));
});

test("returns ordinary modified and untracked text diffs", async () => {
  const root = fixture();
  const tracked = path.join(root, "tracked.txt");
  fs.writeFileSync(tracked, "original\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  fs.writeFileSync(tracked, "updated\n");
  const untracked = path.join(root, "new.txt");
  fs.writeFileSync(untracked, "new text\n");
  for (const [filePath, status, content] of [[tracked, "modified", "+updated"], [untracked, "untracked", "+new text"]]) {
    const response = await request(root, filePath);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.supported, true);
    assert.equal(result.status, status);
    assert.ok(result.patch.includes(content));
  }
});

test("finds the file's repository when the cwd is a plain folder holding several", async () => {
  const parent = fs.mkdtempSync(path.join(base, "parent-"));
  allowFileRoot(parent);
  const repos = ["frontend", "backend"].map((name) => path.join(parent, name));
  for (const repo of repos) {
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    git(repo, "init", "--quiet");
    fs.writeFileSync(path.join(repo, "src", "app.txt"), "original\n");
    fs.writeFileSync(path.join(repo, "gone.txt"), "tracked original\n");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  }
  const [frontend, backend] = repos;
  fs.writeFileSync(path.join(frontend, "src", "app.txt"), "updated\n");
  fs.rmSync(path.join(backend, "src"), { recursive: true });
  for (const [filePath, status, content] of [
    [path.join(frontend, "src", "app.txt"), "modified", "+updated"],
    [path.join(backend, "src", "app.txt"), "deleted", "-original"],
  ]) {
    const response = await request(parent, filePath);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.supported, true);
    assert.equal(result.status, status);
    assert.ok(result.patch.includes(content));
  }
  assert.deepEqual(await (await request(parent, path.join(backend, "gone.txt"))).json(), { supported: false });
});

test("does not run the fsmonitor hook of a checkout other than the cwd's", { skip: process.platform === "win32" }, async () => {
  const parent = fs.mkdtempSync(path.join(base, "hooked-parent-"));
  allowFileRoot(parent);
  const nested = path.join(parent, "nested");
  fs.mkdirSync(nested);
  git(nested, "init", "--quiet");
  fs.writeFileSync(path.join(nested, "app.txt"), "original\n");
  git(nested, "add", ".");
  git(nested, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  const marker = path.join(base, "fsmonitor-ran");
  const hook = path.join(base, "fsmonitor-hook.sh");
  fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  git(nested, "config", "core.fsmonitor", hook);
  fs.writeFileSync(path.join(nested, "app.txt"), "updated\n");

  const result = await (await request(parent, path.join(nested, "app.txt"))).json();
  assert.equal(result.supported, true);
  assert.ok(result.patch.includes("+updated"));
  assert.equal(fs.existsSync(marker), false);
});

test("preserves deleted tracked diffs with existing or missing parents", async () => {
  const root = fixture();
  const nested = path.join(root, "parent", "child");
  fs.mkdirSync(nested, { recursive: true });
  const files = [path.join(root, "deleted.txt"), path.join(nested, "deleted.txt")];
  for (const file of files) fs.writeFileSync(file, "tracked original\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  for (const file of files) fs.unlinkSync(file);
  fs.rmdirSync(nested);
  fs.rmdirSync(path.dirname(nested));
  for (const file of files) {
    const response = await request(root, file);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.supported, true);
    assert.equal(result.status, "deleted");
    assert.ok(result.patch.includes("-tracked original"));
  }
});

test("rejects parent traversal and keeps an absent untracked path unsupported", async () => {
  const root = fixture();
  const response = await request(root, `${root}${path.sep}unused${path.sep}..${path.sep}missing.txt`);
  assert.equal(response.status, 403);
  const missing = await request(root, path.join(root, "absent", "missing.txt"));
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { supported: false });
});

// A diff is bounded by its own output, never by the size of the file it describes.
const LONG_LINE = "abcdefghijklmnopqrstuvwxyz0123456789\n"; // 37 bytes
const LARGE_SIZE = 333 * 1024;

function longText(size) {
  return LONG_LINE.repeat(Math.ceil(size / LONG_LINE.length)).slice(0, size);
}

function changedText(size, marker) {
  return longText(size).replace(LONG_LINE.trimEnd(), marker);
}

function commit(root, message, allowEmpty = false) {
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
    "commit", "--quiet", ...(allowEmpty ? ["--allow-empty"] : []), "-m", message);
}

function largeRepo() {
  const root = fixture();
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.fsmonitor", "false");
  return root;
}

function mergeAllowConflict(root, branch) {
  try {
    git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "merge", "--no-edit", branch);
  } catch {
    // A conflict is expected; execFileSync throws on git's non-zero exit.
  }
}

function gitWithInput(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", input });
}

async function diffOf(root, filePath) {
  const response = await request(root, filePath);
  assert.equal(response.status, 200);
  return response.json();
}

test("shows a tracked file's small diff even when the file exceeds the text preview limit", async () => {
  for (const size of [LARGE_SIZE, 256 * 1024 + 1]) {
    const root = largeRepo();
    const filePath = path.join(root, "large.ts");
    fs.writeFileSync(filePath, longText(size));
    git(root, "add", "-A");
    commit(root, "seed");
    fs.writeFileSync(filePath, changedText(size, "CHANGED_SENTINEL"));

    const result = await diffOf(root, filePath);
    assert.equal(result.supported, true, `size ${size}`);
    assert.equal(result.status, "modified");
    assert.ok(result.patch.includes("+CHANGED_SENTINEL"));
    assert.ok(result.patch.length < 4096, `patch was ${result.patch.length} chars`);
  }
});

test("keeps large untracked and staged added files unsupported", async () => {
  const root = largeRepo();
  const untracked = path.join(root, "new.txt");
  const added = path.join(root, "added.txt");
  fs.writeFileSync(untracked, longText(LARGE_SIZE));
  fs.writeFileSync(added, longText(LARGE_SIZE));
  git(root, "add", "--", "added.txt");

  for (const filePath of [untracked, added]) {
    assert.deepEqual(await diffOf(root, filePath), { supported: false });
  }
});

test("refuses a large binary tracked file through git's own binary detection", async () => {
  const root = largeRepo();
  const filePath = path.join(root, "blob.bin");
  const bytes = Buffer.concat([Buffer.from("bin\n"), Buffer.alloc(LARGE_SIZE, 0)]);
  fs.writeFileSync(filePath, bytes);
  git(root, "add", "-A");
  commit(root, "seed");
  bytes[0] = 0x63;
  fs.writeFileSync(filePath, bytes);

  assert.deepEqual(await diffOf(root, filePath), { supported: false });
});

test("refuses a diff whose output exceeds the diff output limit", async () => {
  const root = largeRepo();
  const filePath = path.join(root, "whole.ts");
  fs.writeFileSync(filePath, "a\n".repeat(200000));
  git(root, "add", "-A");
  commit(root, "seed");
  fs.writeFileSync(filePath, "b\n".repeat(200000));

  assert.deepEqual(await diffOf(root, filePath), { supported: false });
});

test("keeps large deleted and renamed diffs", async () => {
  const root = largeRepo();
  const deleted = path.join(root, "gone.txt");
  const oldPath = path.join(root, "old.txt");
  const newPath = path.join(root, "new.txt");
  fs.writeFileSync(deleted, longText(LARGE_SIZE));
  fs.writeFileSync(oldPath, longText(LARGE_SIZE));
  git(root, "add", "-A");
  commit(root, "seed");
  fs.rmSync(deleted);
  git(root, "mv", "old.txt", "new.txt");
  fs.writeFileSync(newPath, changedText(LARGE_SIZE, "RENAMED_SENTINEL"));

  const gone = await diffOf(root, deleted);
  assert.equal(gone.supported, true);
  assert.equal(gone.status, "deleted");
  assert.ok(gone.patch.includes("-" + LONG_LINE.trimEnd()));

  const renamed = await diffOf(root, newPath);
  assert.equal(renamed.supported, true);
  assert.equal(renamed.status, "renamed");
  assert.ok(renamed.patch.includes("rename from old.txt"));
  assert.ok(renamed.patch.includes("+RENAMED_SENTINEL"));
});

test("keeps a large tracked diff with special path characters and index+worktree changes", async () => {
  const root = largeRepo();
  const name = "-dash file[1].txt";
  const special = path.join(root, name);
  const both = path.join(root, "both.txt");
  fs.writeFileSync(special, longText(LARGE_SIZE));
  fs.writeFileSync(both, longText(LARGE_SIZE) + "v1\n");
  git(root, "add", "--", name);
  git(root, "add", "--", "both.txt");
  commit(root, "seed");
  fs.writeFileSync(special, changedText(LARGE_SIZE, "SPECIAL_SENTINEL"));
  fs.writeFileSync(both, longText(LARGE_SIZE) + "v2\n");
  git(root, "add", "--", "both.txt");
  fs.writeFileSync(both, longText(LARGE_SIZE) + "v3\n");

  const specialResult = await diffOf(root, special);
  assert.equal(specialResult.supported, true);
  assert.ok(specialResult.patch.includes("+SPECIAL_SENTINEL"));

  const bothResult = await diffOf(root, both);
  assert.equal(bothResult.supported, true);
  assert.ok(bothResult.patch.includes("v3"));
  assert.ok(!bothResult.patch.includes("v2"));
});

test("conflicts follow HEAD's baseline, not the status name", async () => {
  // Both-modified: HEAD holds the blob, so a large file is still a tracked diff.
  {
    const root = largeRepo();
    const filePath = path.join(root, "both.txt");
    fs.writeFileSync(filePath, longText(LARGE_SIZE) + "base\n");
    git(root, "add", "-A");
    commit(root, "base");
    const main = git(root, "symbolic-ref", "--short", "HEAD").trim();
    git(root, "checkout", "-q", "-b", "other");
    fs.writeFileSync(filePath, longText(LARGE_SIZE) + "theirs\n");
    git(root, "add", "-A");
    commit(root, "theirs");
    git(root, "checkout", "-q", main);
    fs.writeFileSync(filePath, longText(LARGE_SIZE) + "ours\n");
    git(root, "add", "-A");
    commit(root, "ours");
    mergeAllowConflict(root, "other");

    const result = await diffOf(root, filePath);
    assert.equal(result.supported, true);
    assert.equal(result.status, "conflict");
    assert.ok(result.patch.includes("<<<<<<<"));
  }

  // Both-added with no HEAD blob: the new-file bound still applies.
  {
    const root = largeRepo();
    commit(root, "base", true);
    const filePath = path.join(root, "both.txt");
    const ours = gitWithInput(root, ["hash-object", "-w", "--stdin"], "ours\n").trim();
    const theirs = gitWithInput(root, ["hash-object", "-w", "--stdin"], "theirs\n").trim();
    gitWithInput(root, ["update-index", "--index-info"],
      `100644 ${ours} 2\tboth.txt\n100644 ${theirs} 3\tboth.txt\n`);

    fs.writeFileSync(filePath, longText(LARGE_SIZE));
    assert.deepEqual(await diffOf(root, filePath), { supported: false });

    fs.writeFileSync(filePath, "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n");
    const small = await diffOf(root, filePath);
    assert.equal(small.supported, true);
    assert.equal(small.status, "conflict");
  }
});

test("a submodule path in HEAD is not diffed as an ordinary tracked file", async () => {
  const root = largeRepo();
  const tracked = path.join(root, "tracked.txt");
  fs.mkdirSync(path.join(root, "dir"));
  fs.writeFileSync(tracked, "base\n");
  fs.writeFileSync(path.join(root, "dir", "f.txt"), "dir\n");
  git(root, "add", "-A");
  commit(root, "base");

  const head = git(root, "rev-parse", "HEAD").trim();
  git(root, "update-index", "--add", "--cacheinfo", "160000", head, "sub");
  commit(root, "gitlink");
  const sub = path.join(root, "sub");
  fs.mkdirSync(sub);
  git(sub, "init", "--quiet");
  fs.writeFileSync(path.join(sub, "s.txt"), "sub content\n");
  git(sub, "add", "-A");
  commit(sub, "sub");

  // Its diff carries a hunk ("Subproject commit …"), yet it is no file.
  assert.deepEqual(await diffOf(root, sub), { supported: false });

  // An ordinary blob is still diffed from HEAD.
  fs.writeFileSync(tracked, "changed\n");
  const ordinary = await diffOf(root, tracked);
  assert.equal(ordinary.supported, true);
  assert.equal(ordinary.status, "modified");
  assert.ok(ordinary.patch.includes("+changed"));
});

test("a tracked file turned into a link is not shown as its target's diff", async () => {
  const root = largeRepo();
  fs.writeFileSync(path.join(root, "target.txt"), "before\n");
  fs.writeFileSync(path.join(root, "turned.txt"), "file\n");
  git(root, "add", "-A");
  commit(root, "seed");
  fs.writeFileSync(path.join(root, "target.txt"), "after\n");
  fs.rmSync(path.join(root, "turned.txt"));
  fs.symlinkSync("target.txt", path.join(root, "turned.txt"));

  assert.deepEqual(await diffOf(root, path.join(root, "turned.txt")), { supported: false });
});
