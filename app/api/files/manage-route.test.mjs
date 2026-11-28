import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-manage-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRoots = globalThis.__piAllowedRootsCache;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { POST } = await jiti.import("./[...path]/route.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

function fixture(...extraRoots) {
  const root = fs.mkdtempSync(path.join(base, "project-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.txt"), "a");
  fs.writeFileSync(path.join(root, "b.txt"), "b");
  globalThis.__piAllowedRootsCache = {
    roots: new Set([root, ...extraRoots.map((r) => path.join(root, r))]),
    expiresAt: Date.now() + 60_000,
  };
  return root;
}

async function call(target, type, body = {}) {
  const encoded = encodeFilePathForApi(target);
  const response = await POST(new NextRequest(`http://localhost/api/files/${encoded}?type=${type}`, {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) });
  return { status: response.status, data: await response.json() };
}

test("mkdir, rename, move and delete inside the project", async () => {
  const root = fixture();
  assert.equal((await call(root, "mkdir", { name: "docs" })).status, 200);
  assert.ok(fs.statSync(path.join(root, "docs")).isDirectory());
  assert.equal((await call(root, "mkdir", { name: "docs" })).status, 409);

  assert.equal((await call(path.join(root, "b.txt"), "move", { destination: root, name: "c.txt" })).status, 200);
  assert.equal(fs.readFileSync(path.join(root, "c.txt"), "utf8"), "b");

  assert.equal((await call(path.join(root, "c.txt"), "move", { destination: path.join(root, "src"), name: "c.txt" })).status, 200);
  assert.ok(fs.existsSync(path.join(root, "src", "c.txt")));

  assert.equal((await call(path.join(root, "src"), "delete")).status, 200);
  assert.equal(fs.existsSync(path.join(root, "src")), false);
});

test("a move never replaces an existing entry", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "b.txt"), "other");
  const { status } = await call(path.join(root, "b.txt"), "move", { destination: path.join(root, "src"), name: "b.txt" });
  assert.equal(status, 409);
  assert.equal(fs.readFileSync(path.join(root, "src", "b.txt"), "utf8"), "other");
  assert.equal(fs.readFileSync(path.join(root, "b.txt"), "utf8"), "b");
});

test("refuses a folder into itself, paths in names, .git and `..`", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "src", "inner"));
  assert.equal((await call(path.join(root, "src"), "move", { destination: path.join(root, "src", "inner"), name: "src" })).status, 400);
  assert.equal((await call(path.join(root, "b.txt"), "move", { destination: root, name: "../b.txt" })).status, 400);
  assert.equal((await call(root, "mkdir", { name: ".git" })).status, 400);
  assert.equal((await call(path.join(root, "b.txt"), "move", { destination: `${root}/src/..`, name: "x.txt" })).status, 403);
});

test("refuses writes outside the roots and on the project folder", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  assert.equal((await call(path.join(root, "b.txt"), "move", { destination: outside, name: "b.txt" })).status, 403);
  assert.equal((await call(outside, "mkdir", { name: "x" })).status, 403);
  assert.ok(fs.existsSync(path.join(root, "b.txt")));

  // A project folder nested in another (a worktree) is the sidebar's.
  fs.mkdirSync(path.join(root, "wt"));
  globalThis.__piAllowedRootsCache.roots.add(path.join(root, "wt"));
  assert.equal((await call(path.join(root, "wt"), "delete")).status, 403);
  assert.ok(fs.existsSync(path.join(root, "wt")));
});

test("a link is deleted itself, not its target", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
  fs.symlinkSync(outside, path.join(root, "link"));
  assert.equal((await call(path.join(root, "link"), "delete")).status, 200);
  assert.equal(fs.existsSync(path.join(root, "link")), false);
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep");
});

test("a move across disks says so", async (t) => {
  const root = fixture();
  t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
  });
  const { status, data } = await call(path.join(root, "b.txt"), "move", { destination: path.join(root, "src"), name: "b.txt" });
  assert.equal(status, 400);
  assert.equal(data.error, "Cannot move between disks");
});

test(".git and anything in it are refused, in any case", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref");
  // `.GIT` and `.git.` are `.git` on a case-insensitive disk and on Windows.
  for (const name of [".git", ".GIT", ".Git", ".git."]) {
    assert.equal((await call(path.join(root, name), "delete")).status, 403, name);
    assert.equal((await call(root, "mkdir", { name })).status, 400, name);
    assert.equal((await call(path.join(root, "b.txt"), "move", { destination: root, name })).status, 400, name);
  }
  assert.equal((await call(path.join(root, ".git", "HEAD"), "delete")).status, 403);
  assert.equal((await call(path.join(root, ".GIT", "HEAD"), "delete")).status, 403);
  assert.equal((await call(path.join(root, ".git", "HEAD"), "move", { destination: root, name: "HEAD" })).status, 403);
  assert.equal((await call(path.join(root, "b.txt"), "move", { destination: path.join(root, ".git", "hooks"), name: "pre-commit" })).status, 403);
  assert.equal((await call(path.join(root, ".git"), "mkdir", { name: "x" })).status, 403);
  assert.equal(fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8"), "ref");
  assert.equal(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")), false);
  assert.ok(fs.existsSync(path.join(root, "b.txt")));
});

test("a move onto a hard link of the same file is refused, not a silent no-op", async () => {
  const root = fixture();
  fs.linkSync(path.join(root, "b.txt"), path.join(root, "y.txt"));
  const { status } = await call(path.join(root, "b.txt"), "move", { destination: root, name: "y.txt" });
  assert.equal(status, 409);
  assert.ok(fs.existsSync(path.join(root, "b.txt")));
});
