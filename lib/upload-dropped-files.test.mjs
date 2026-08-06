import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { uploadDroppedFiles } = await jiti.import("./upload-dropped-files.ts");

function makeFile(name, content = "data", type = "text/plain") {
  return new File([content], name, { type });
}

test("returns an empty list for no files", async () => {
  const result = await uploadDroppedFiles([]);
  assert.deepEqual(result, []);
});

test("posts files and returns the uploaded paths", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/drop-files");
    assert.equal(init.method, "POST");
    capturedBody = init.body;
    return new Response(JSON.stringify({ paths: ["/tmp/pi-web-drops-x/a.txt"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const paths = await uploadDroppedFiles([makeFile("a.txt")]);
    assert.deepEqual(paths, ["/tmp/pi-web-drops-x/a.txt"]);
    assert.ok(capturedBody instanceof FormData, "body should be FormData");
    assert.equal(capturedBody.getAll("files").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws a descriptive error when the upload fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Too large" }), { status: 413 });
  try {
    await assert.rejects(() => uploadDroppedFiles([makeFile("b.txt")]), /Too large/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
