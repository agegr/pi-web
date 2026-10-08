import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-save-route-")));
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
const { GET, POST } = await jiti.import("./[...path]/route.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { TEXT_EDIT_MAX_BYTES } = await jiti.import("../../../lib/file-types.ts");
const { NextRequest } = await jiti.import("next/server");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixture(contents = "original\n") {
  const directory = fs.mkdtempSync(path.join(base, "files-"));
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Date.now() + 60_000 };
  const file = path.join(directory, "notes.txt");
  fs.writeFileSync(file, contents);
  return { directory, file };
}

function params(filePath) {
  const encoded = encodeFilePathForApi(filePath);
  return { encoded, context: { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) } };
}

async function readForEditing(filePath) {
  const { encoded, context } = params(filePath);
  const response = await GET(new NextRequest(`http://localhost/api/files/${encoded}?type=read&edit=1`, {
    headers: { host: "localhost" },
  }), context);
  return { status: response.status, body: await response.json() };
}

async function save(filePath, body, headers = {}) {
  const { encoded, context } = params(filePath);
  const response = await POST(new NextRequest(`http://localhost/api/files/${encoded}?type=save`, {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), context);
  return { status: response.status, body: await response.json() };
}

test("an editable read returns the whole file with its hash and line separator", async () => {
  const { file } = fixture("one\r\ntwo\r\n");
  const { status, body } = await readForEditing(file);
  assert.equal(status, 200);
  assert.equal(body.content, "one\r\ntwo\r\n");
  assert.equal(body.hash, sha256("one\r\ntwo\r\n"));
  assert.equal(body.eol, "\r\n");
  assert.equal(body.editable, true);
  assert.equal(body.truncated, false);
  assert.equal(body.readOnlyReason, undefined);
});

test("files an editor cannot write back unchanged are read-only", async () => {
  for (const [contents, reason] of [
    [Buffer.from([0x61, 0x00, 0x62]), "binary"],
    [Buffer.from([0x61, 0xff, 0x62]), "encoding"],
    ["mixed\r\nline\nendings\n", "line-endings"],
    ["bare\rcarriage return", "line-endings"],
  ]) {
    const { file } = fixture(contents);
    const { body } = await readForEditing(file);
    assert.equal(body.editable, false, reason);
    assert.equal(body.readOnlyReason, reason);
  }
});

test("a file above the edit limit falls back to the chunked read-only preview", async () => {
  const { file } = fixture("a".repeat(TEXT_EDIT_MAX_BYTES + 1));
  const { body } = await readForEditing(file);
  assert.equal(body.editable, false);
  assert.equal(body.readOnlyReason, "too-large");
  assert.equal(body.truncated, true);
  assert.equal(body.hash, undefined);
});

test("a symbolic link reads as read-only and refuses saves", async () => {
  const { directory, file } = fixture();
  const link = path.join(directory, "link.txt");
  fs.symlinkSync(file, link);
  const { body } = await readForEditing(link);
  assert.equal(body.readOnlyReason, "symlink");
  const saved = await save(link, { content: "changed", baseHash: body.hash });
  assert.equal(saved.status, 400);
  assert.equal(fs.readFileSync(file, "utf8"), "original\n");
});

test("a save with the current hash replaces the file and keeps its mode", async () => {
  const { directory, file } = fixture();
  fs.chmodSync(file, 0o640);
  const { body: before } = await readForEditing(file);
  const { status, body } = await save(file, { content: "edited\n", baseHash: before.hash });
  assert.equal(status, 200);
  assert.equal(body.hash, sha256("edited\n"));
  assert.equal(body.size, 7);
  assert.equal(fs.readFileSync(file, "utf8"), "edited\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(directory), ["notes.txt"]);
});

test("a save based on a stale hash answers 409 and leaves the file alone", async () => {
  const { file } = fixture();
  const { body: before } = await readForEditing(file);
  fs.writeFileSync(file, "changed by the agent\n");
  const { status, body } = await save(file, { content: "mine\n", baseHash: before.hash });
  assert.equal(status, 409);
  assert.equal(body.currentHash, sha256("changed by the agent\n"));
  assert.equal(fs.readFileSync(file, "utf8"), "changed by the agent\n");
});

test("an unchanged save does not rewrite the file", async () => {
  const { file } = fixture();
  const inode = fs.statSync(file).ino;
  const { body: before } = await readForEditing(file);
  const { status } = await save(file, { content: "original\n", baseHash: before.hash });
  assert.equal(status, 200);
  assert.equal(fs.statSync(file).ino, inode);
});

test("concurrent saves from one base: the first wins, the second conflicts", async () => {
  const { file } = fixture();
  const { body: before } = await readForEditing(file);
  const [first, second] = await Promise.all([
    save(file, { content: "first\n", baseHash: before.hash }),
    save(file, { content: "second\n", baseHash: before.hash }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(fs.readFileSync(file, "utf8"), "first\n");
});

test("saves outside the allowed roots, through `..` or to missing files are refused", async () => {
  const { directory, file } = fixture();
  const outside = path.join(base, "outside.txt");
  fs.writeFileSync(outside, "secret\n");
  const baseHash = sha256("secret\n");
  assert.equal((await save(outside, { content: "x", baseHash })).status, 403);
  assert.equal((await save(`${directory}/sub/../../outside.txt`, { content: "x", baseHash })).status, 403);
  assert.equal(fs.readFileSync(outside, "utf8"), "secret\n");
  assert.equal((await save(path.join(directory, "missing.txt"), { content: "x", baseHash })).status, 404);
  assert.equal((await save(directory, { content: "x", baseHash })).status, 400);
  assert.equal(fs.readFileSync(file, "utf8"), "original\n");
});

test("malformed save requests are refused before touching the file", async () => {
  const { file } = fixture();
  const baseHash = sha256("original\n");
  assert.equal((await save(file, { content: "x", baseHash }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await save(file, "{not json")).status, 400);
  assert.equal((await save(file, { content: 1, baseHash })).status, 400);
  assert.equal((await save(file, { content: "x", baseHash: "abc" })).status, 400);
  assert.equal((await save(file, { content: "a".repeat(TEXT_EDIT_MAX_BYTES + 1), baseHash })).status, 413);
  assert.equal(fs.readFileSync(file, "utf8"), "original\n");
});

test("saves from another origin are refused", async () => {
  const { file } = fixture();
  const { status } = await save(file, { content: "x", baseHash: sha256("original\n") }, { origin: "https://evil.example" });
  assert.equal(status, 403);
  assert.equal(fs.readFileSync(file, "utf8"), "original\n");
});
