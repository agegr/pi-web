import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

function post(body) {
  return POST(new Request("http://localhost/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("rejects a missing path", async () => {
  const response = await post({});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "path required" });
});

test("rejects a request that did not come from this machine", async () => {
  // A phone on the LAN must not raise a window on the host.
  const response = await POST(new Request("http://192.168.1.9:30141/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/tmp" }),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Only a browser on this machine can open the file manager" });
});

test("rejects a path that does not exist", async () => {
  const response = await post({ path: path.join(os.tmpdir(), `pi-web-open-folder-missing-${process.pid}`) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "path not found" });
});

test("rejects a file outside the allowed roots", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-open-folder-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "file.txt");
  await writeFile(file, "x");
  // Files are accepted (revealed) like folders, but the allow-list still
  // guards the spawn: a path outside every root never reaches the file manager.
  const response = await post({ path: file });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("rejects a directory outside the allowed roots", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-open-folder-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const response = await post({ path: dir });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});
