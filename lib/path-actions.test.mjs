import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { pathIsReadableFile, revealPathInFileManager } = await jiti.import("./path-actions.ts");
const { encodeFilePathForApi } = await jiti.import("./file-paths.ts");

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("treats a file the API can serve as previewable", async () => {
  const calls = stubFetch(() => jsonResponse(200, { size: 3, language: "text" }));

  assert.equal(await pathIsReadableFile("F:/work/note.txt"), true);
  assert.equal(calls[0].url, `/api/files/${encodeFilePathForApi("F:/work/note.txt")}?type=meta`);

  delete globalThis.fetch;
});

test("treats a directory (and any other rejection) as not previewable", async () => {
  stubFetch(() => jsonResponse(400, { error: "Not a file" }));
  assert.equal(await pathIsReadableFile("F:/work/b"), false);

  stubFetch(() => jsonResponse(403, { error: "Access denied" }));
  assert.equal(await pathIsReadableFile("/etc/passwd"), false);

  stubFetch(() => { throw new Error("offline"); });
  assert.equal(await pathIsReadableFile("F:/work/note.txt"), false);

  delete globalThis.fetch;
});

test("reveals a path through the open-folder route", async () => {
  const calls = stubFetch(() => jsonResponse(200, { ok: true }));

  assert.equal(await revealPathInFileManager("F:/work/b"), null);
  assert.equal(calls[0].url, "/api/open-folder");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { path: "F:/work/b" });

  delete globalThis.fetch;
});

test("surfaces the route error message when revealing fails", async () => {
  stubFetch(() => jsonResponse(403, { error: "Access denied" }));
  assert.equal(await revealPathInFileManager("/etc/passwd"), "Access denied");

  stubFetch(() => jsonResponse(500, {}));
  assert.equal(await revealPathInFileManager("F:/work/b"), "HTTP 500");

  stubFetch(() => { throw new Error("offline"); });
  assert.equal(await revealPathInFileManager("F:/work/b"), "offline");

  delete globalThis.fetch;
});
