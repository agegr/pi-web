import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-backpressure-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

test("a download is read from disk only as fast as the client takes it", async () => {
  const size = 16 * 1024 * 1024;
  const file = path.join(root, "big.bin");
  fs.writeFileSync(file, Buffer.alloc(size, 1));

  const original = fs.createReadStream;
  let stream;
  fs.createReadStream = (...args) => (stream = original.apply(fs, args));
  let response;
  try {
    response = await GET(new NextRequest("http://localhost/api/files/x?type=download"), {
      params: Promise.resolve({ path: file.split(path.sep).filter(Boolean) }),
    });
  } finally {
    fs.createReadStream = original;
  }
  assert.equal(response.status, 200);
  // A client that has not read a byte yet: the whole file must not pile up in memory.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const readSoFar = stream.bytesRead;
  await response.body.cancel();
  assert.ok(readSoFar < size / 4, `read ${readSoFar} of ${size} bytes for a client that read none`);
});

test("a client that keeps reading still receives the whole file", async () => {
  const file = path.join(root, "whole.bin");
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 123, 7);
  fs.writeFileSync(file, bytes);
  const response = await GET(new NextRequest("http://localhost/api/files/x?type=download"), {
    params: Promise.resolve({ path: file.split(path.sep).filter(Boolean) }),
  });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, bytes.length);
  assert.ok(body.equals(bytes));
});
