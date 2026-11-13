import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-range-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

test("download ranges require at least one bound and preserve valid suffix/open ranges", async () => {
  const file = path.join(root, "download.txt");
  fs.writeFileSync(file, "abcdef");
  const request = (range) => GET(new NextRequest("http://localhost/api/files/x?type=download", { headers: { range } }), {
    params: Promise.resolve({ path: file.replace(/\\/g, "/").split("/").filter(Boolean) }),
  });
  const invalid = await request("bytes=-");
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */6");
  for (const [range, content] of [["bytes=-2", "ef"], ["bytes=2-", "cdef"], ["bytes=1-3", "bcd"]]) {
    const response = await request(range);
    assert.equal(response.status, 206);
    assert.equal(await response.text(), content);
  }
});
