import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-files-route-")));
fs.writeFileSync(path.join(root, "gitconfig"), "");
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = path.join(root, "gitconfig");
process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
process.env.GIT_CEILING_DIRECTORIES = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

function write(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function request(filePath, type) {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return GET(
    new NextRequest(`http://localhost/api/files/x?type=${type}`),
    { params: Promise.resolve({ path: segments }) },
  );
}

async function listNames(dir) {
  const response = await request(dir, "list");
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  return entries.map((entry) => entry.name);
}

test("lists a tracked build/ in a Git work tree and hides what it ignores", async () => {
  const repo = path.join(root, "repo");
  write(path.join(repo, ".gitignore"), "dist/\n");
  write(path.join(repo, "build/index.js"));
  write(path.join(repo, "dist/bundle.js"), "bundle");
  write(path.join(repo, "src/main.ts"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ".gitignore", "build", "src"]);

  assert.deepEqual(await listNames(repo), ["build", "src", ".gitignore"]);

  // Visibility only: an ignored file is still readable by its path.
  const read = await request(path.join(repo, "dist/bundle.js"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "bundle");
});

test("keeps the name list for a directory outside Git", async () => {
  const plain = path.join(root, "plain");
  write(path.join(plain, "build/index.js"));
  write(path.join(plain, "node_modules/pkg/index.js"));
  write(path.join(plain, "src/main.ts"));

  assert.deepEqual(await listNames(plain), ["src"]);
});
