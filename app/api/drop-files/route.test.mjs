import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { POST } = await jiti.import("./route.ts");

function makeRequest(formData, { method = "POST" } = {}) {
  return new Request("http://localhost/api/drop-files", { method, body: formData });
}

test("writes dropped files to a temp directory and returns absolute paths", async () => {
  const form = new FormData();
  form.append("files", new File(["hello world"], "a.txt", { type: "text/plain" }));
  form.append("files", new File(["{json}"], "b.json", { type: "application/json" }));

  const res = await POST(makeRequest(form));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.paths.length, 2);
  for (const p of data.paths) {
    assert.ok(p.startsWith(path.join(os.tmpdir(), "pi-web-drops-")), `unexpected path: ${p}`);
    assert.ok(fs.existsSync(p), `file should exist: ${p}`);
  }
  assert.equal(fs.readFileSync(data.paths[0], "utf-8"), "hello world");
  assert.equal(fs.readFileSync(data.paths[1], "utf-8"), "{json}");
  fs.rmSync(path.dirname(data.paths[0]), { recursive: true, force: true });
});

test("renames colliding file names instead of overwriting", async () => {
  const form = new FormData();
  form.append("files", new File(["first"], "same.txt"));
  form.append("files", new File(["second"], "same.txt"));

  const res = await POST(makeRequest(form));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.paths.length, 2);
  const contents = data.paths.map((p) => fs.readFileSync(p, "utf-8")).sort();
  assert.deepEqual(contents, ["first", "second"]);
  fs.rmSync(path.dirname(data.paths[0]), { recursive: true, force: true });
});

test("rejects path traversal file names", async () => {
  const form = new FormData();
  form.append("files", new File(["x"], "../evil.txt"));

  const res = await POST(makeRequest(form));
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Invalid file name/);
});

test("rejects empty uploads", async () => {
  const res = await POST(makeRequest(new FormData()));
  assert.equal(res.status, 400);
});
