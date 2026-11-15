import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-route-")));
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

function fixture() {
  const directory = fs.mkdtempSync(path.join(base, "files-"));
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Date.now() + 60_000 };
  const destination = path.join(directory, "important.txt");
  fs.writeFileSync(destination, "original contents");
  return { directory, destination };
}

async function upload(directory, strategy = "overwrite", names = ["important.txt"], contents = "replacement") {
  const encoded = encodeFilePathForApi(directory);
  const form = new FormData();
  for (const name of names) form.append("files", new File([contents], name));
  return POST(new NextRequest(`http://localhost/api/files/${encoded}?type=upload&conflict=${strategy}`, {
    method: "POST", headers: { host: "localhost" }, body: form,
  }), { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) });
}

for (const partial of [false, true]) {
  test(`failed overwrite preserves original and cleans staging (partial write: ${partial})`, async (t) => {
    const { directory, destination } = fixture();
    const write = fs.promises.writeFile;
    let injected = false;
    t.mock.method(fs.promises, "writeFile", async (target, ...args) => {
      if (String(target).startsWith(directory + path.sep)) {
        injected = true;
        if (partial) await write(target, "partial replacement", args[1]);
        throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
      }
      return write(target, ...args);
    });
    const response = await upload(directory);
    assert.equal(injected, true);
    assert.equal(response.status, 207);
    assert.deepEqual(await response.json(), {
      uploaded: [], skipped: [], errors: [{ name: "important.txt", error: "simulated ENOSPC" }],
    });
    assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
    assert.deepEqual(fs.readdirSync(directory), ["important.txt"]);
  });
}

test("failed replacement rename preserves original and cleans staging", async (t) => {
  const { directory, destination } = fixture();
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === destination) {
      assert.equal(fs.readFileSync(from, "utf8"), "replacement");
      assert.equal(fs.readFileSync(to, "utf8"), "original contents");
      throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
    }
    return rename(from, to);
  });
  const response = await upload(directory);
  assert.equal(response.status, 207);
  assert.equal((await response.json()).errors[0].error, "simulated EACCES");
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
  assert.deepEqual(fs.readdirSync(directory), ["important.txt"]);
});

test("successful overwrite and fresh upload leave only complete destination files", async () => {
  const { directory, destination } = fixture();
  const response = await upload(directory, "overwrite", ["important.txt", "new.txt"]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { uploaded: ["important.txt", "new.txt"], skipped: [], errors: [] });
  assert.equal(fs.readFileSync(destination, "utf8"), "replacement");
  assert.equal(fs.readFileSync(path.join(directory, "new.txt"), "utf8"), "replacement");
  assert.deepEqual(fs.readdirSync(directory).sort(), ["important.txt", "new.txt"]);
});

test("refuses a destination changed to a link while the replacement is staged", async (t) => {
  const { directory, destination } = fixture();
  const outside = fs.mkdtempSync(path.join(base, "changed-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "private contents");
  const write = fs.promises.writeFile;
  t.mock.method(fs.promises, "writeFile", async (target, ...args) => {
    const result = await write(target, ...args);
    if (String(target).startsWith(directory + path.sep)) {
      fs.unlinkSync(destination);
      fs.symlinkSync(outside, destination, process.platform === "win32" ? "junction" : "dir");
    }
    return result;
  });
  const response = await upload(directory);
  assert.equal(response.status, 207);
  assert.equal((await response.json()).errors[0].error, "Cannot replace a directory or symbolic link");
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "private contents");
  assert.deepEqual(fs.readdirSync(directory), ["important.txt"]);
});

test("one file may fill the 100MB limit, and one byte more is refused", async () => {
  const { directory } = fixture();
  const limit = 100 * 1024 * 1024;

  const atLimit = await upload(directory, "error", ["full.bin"], Buffer.alloc(limit));
  assert.equal(atLimit.status, 200);
  assert.deepEqual(await atLimit.json(), { uploaded: ["full.bin"], skipped: [], errors: [] });
  assert.equal(fs.statSync(path.join(directory, "full.bin")).size, limit);

  const over = await upload(directory, "error", ["over.bin"], Buffer.alloc(limit + 1));
  assert.equal(over.status, 413);
  assert.deepEqual(await over.json(), { error: "Uploads must total 100MB or less" });
  assert.deepEqual(fs.readdirSync(directory).sort(), ["full.bin", "important.txt"]);
});

test("files that pass the limit only together are refused before any is written", async () => {
  const { directory } = fixture();
  const half = Buffer.alloc(50 * 1024 * 1024 + 1);
  const response = await upload(directory, "error", ["first.bin", "second.bin"], half);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Uploads must total 100MB or less" });
  assert.deepEqual(fs.readdirSync(directory), ["important.txt"]);
});

test("error and skip conflict strategies preserve the existing file", async () => {
  const { directory, destination } = fixture();
  assert.equal((await upload(directory, "error")).status, 409);
  const response = await upload(directory, "skip");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { uploaded: [], skipped: ["important.txt"], errors: [] });
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
});

test("overwrite refuses directories and directory links without touching their targets", async () => {
  const { directory } = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "private contents");
  fs.mkdirSync(path.join(directory, "folder"));
  fs.symlinkSync(outside, path.join(directory, "linked"), process.platform === "win32" ? "junction" : "dir");
  const response = await upload(directory, "overwrite", ["folder", "linked"]);
  assert.equal(response.status, 207);
  const body = await response.json();
  assert.deepEqual(body.uploaded, []);
  assert.deepEqual(body.errors.map((entry) => entry.name), ["folder", "linked"]);
  assert.equal(fs.lstatSync(path.join(directory, "linked")).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "private contents");
});
