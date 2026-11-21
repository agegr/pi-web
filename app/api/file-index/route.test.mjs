import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-index-")));
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
  delete globalThis.__piFileIndexCache;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: "pipe" });
}

async function list(cwd) {
  const url = new URL("http://localhost/api/file-index");
  url.searchParams.set("cwd", cwd);
  return (await (await GET(new NextRequest(url))).json()).files;
}

test("the @ index lists a file in a merge conflict once", async () => {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet", "-b", "main");
  allowFileRoot(root);
  fs.writeFileSync(path.join(root, "keep.txt"), "base\n");
  fs.writeFileSync(path.join(root, "other.txt"), "x\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "other");
  fs.writeFileSync(path.join(root, "keep.txt"), "other\n");
  git(root, "commit", "-qam", "other");
  git(root, "checkout", "-q", "main");
  fs.writeFileSync(path.join(root, "keep.txt"), "main\n");
  git(root, "commit", "-qam", "main");
  assert.throws(() => git(root, "merge", "other"));
  fs.writeFileSync(path.join(root, "new file.txt"), "n\n");

  assert.deepEqual((await list(root)).sort(), ["keep.txt", "new file.txt", "other.txt"]);
});
