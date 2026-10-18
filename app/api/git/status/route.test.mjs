import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-status-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { invalidateGitStatusCache } = await jiti.import("../../../../lib/git-status-cache.ts");
const { NextRequest } = await jiti.import("next/server");

test.after(() => {
  invalidateGitStatusCache();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet");
  fs.writeFileSync(path.join(root, "tracked.txt"), "original\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  fs.writeFileSync(path.join(root, "tracked.txt"), "updated\n");
  allowFileRoot(root);
  return root;
}

async function request(cwd) {
  const url = new URL("http://localhost/api/git/status");
  url.searchParams.set("cwd", cwd);
  const response = await GET(new NextRequest(url));
  return { response, body: await response.json() };
}

test("answers the listing the sidebar consumes", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "untracked.txt"), "one\ntwo\n");
  const { response, body } = await request(root);

  assert.equal(response.status, 200);
  assert.equal(body.isGitRepository, true);
  assert.equal(typeof body.repositoryRoot, "string");
  const byPath = new Map(body.files.map((file) => [file.filePath, file]));
  assert.deepEqual(byPath.get(path.join(root, "tracked.txt")), {
    filePath: path.join(root, "tracked.txt"),
    status: "modified",
    code: "M",
    indexStatus: " ",
    worktreeStatus: "M",
  });
  assert.equal(byPath.get(path.join(root, "untracked.txt"))?.status, "untracked");
  assert.equal(body.additions, 3);
  assert.equal(body.deletions, 1);
});

test("reuses one scan inside the TTL, never across projects, and invalidates eagerly", async () => {
  invalidateGitStatusCache();
  const root = fixture();
  const other = fixture();

  const first = await request(root);
  const otherListing = await request(other);
  assert.equal(otherListing.response.status, 200);
  assert.ok(
    otherListing.body.files.some((file) => file.filePath === path.join(other, "tracked.txt")),
    "a second cwd answers about its own files",
  );
  assert.ok(
    !otherListing.body.files.some((file) => file.filePath === path.join(root, "tracked.txt")),
    "a second cwd is never served the first cwd's listing",
  );

  // The scan is what is cached: a file added inside the TTL does not appear...
  fs.writeFileSync(path.join(root, "added-inside-ttl.txt"), "new\n");
  const cached = await request(root);
  assert.deepEqual(cached.body, first.body);

  // ...until the write invalidates it, which is what an upload does.
  invalidateGitStatusCache();
  const rescanned = await request(root);
  assert.ok(
    rescanned.body.files.some((file) => file.filePath === path.join(root, "added-inside-ttl.txt")),
    "an invalidated listing rescans",
  );
});
