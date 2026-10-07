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
