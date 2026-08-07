import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import path from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { getAttachmentsDir } = await jiti.import("@/lib/attachments-dir.ts");

const dir = getAttachmentsDir();
fs.mkdirSync(dir, { recursive: true });
const testFile = path.join(dir, "att-test.txt");
fs.writeFileSync(testFile, "attachment content");

test("serves an existing attachment with download disposition", async () => {
  const res = await GET(new Request("http://localhost/api/attachments?name=att-test.txt"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-disposition")?.includes("attachment"), true);
  assert.equal(res.headers.get("content-disposition")?.includes("att-test.txt"), true);
  const text = await res.text();
  assert.equal(text, "attachment content");
});

test("rejects missing files with 404", async () => {
  const res = await GET(new Request("http://localhost/api/attachments?name=nope.txt"));
  assert.equal(res.status, 404);
});

test("rejects path traversal and empty names", async () => {
  const traversal = await GET(new Request("http://localhost/api/attachments?name=..%2F..%2Fetc%2Fpasswd"));
  assert.equal(traversal.status, 400);
  const empty = await GET(new Request("http://localhost/api/attachments?name="));
  assert.equal(empty.status, 400);
});

test("cleanup", () => {
  fs.rmSync(testFile, { force: true });
});

test("serves files from uuid subdirectories via the path param", async () => {
  const dir = path.join(getAttachmentsDir(), "test-uuid-123");
  fs.mkdirSync(dir, { recursive: true });
  const subFile = path.join(dir, "报告文档.pdf");
  fs.writeFileSync(subFile, "subdir content");
  const full = `http://localhost/api/attachments?path=${encodeURIComponent(subFile)}`;
  const res = await GET(new Request(full));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-disposition")?.includes("filename*=UTF-8''"), true);
  assert.equal(await res.text(), "subdir content");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects paths outside the attachments directory", async () => {
  const res = await GET(new Request(`http://localhost/api/attachments?path=${encodeURIComponent("/etc/passwd")}`));
  assert.equal(res.status, 403);
});

test("rejects traversal paths", async () => {
  const res = await GET(new Request("http://localhost/api/attachments?path=..%2F..%2Fetc%2Fpasswd"));
  assert.equal(res.status, 403);
});
