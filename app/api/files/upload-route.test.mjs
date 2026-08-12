import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../../../src/routes/api/files/$.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

function segmentsFor(filePath) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function uploadRequest(directory, name, content, conflict = "error") {
  const form = new FormData();
  form.append("files", new File([content], name));
  return new Request(`http://localhost/api/files/${segmentsFor(directory).join("/")}?type=upload&conflict=${conflict}`, {
    method: "POST",
    headers: { host: "localhost" },
    body: form,
  });
}

test("files route uses standard Web request and response APIs", () => {
  assert.doesNotMatch(routeSource, /next\/server|NextRequest|NextResponse|\.nextUrl/);
  assert.match(routeSource, /Response\.json/);
  assert.match(routeSource, /new URL\(request\.url\)\.searchParams/);
});

test("TanStack files route adapts the splat to decoded path segments", () => {
  assert.match(adapterSource, /params\._splat \?\? ""\)\.split\("\/"\)/);
  assert.match(adapterSource, /postFiles\(request/);
});

test("multipart upload preserves success, conflict, and size responses", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-tanstack-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
  const { POST } = await jiti.import("./[...path]/route.ts");
  allowFileRoot(root);

  const context = { params: Promise.resolve({ path: segmentsFor(root) }) };
  const created = await POST(uploadRequest(root, "proof.txt", "tanstack"), context);
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { uploaded: ["proof.txt"], skipped: [], errors: [] });
  assert.equal(fs.readFileSync(path.join(root, "proof.txt"), "utf8"), "tanstack");

  const conflict = await POST(uploadRequest(root, "proof.txt", "replacement"), context);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "One or more files already exist",
    conflicts: ["proof.txt"],
    nonReplaceable: [],
  });

  const oversized = new Request(`http://localhost/api/files/${segmentsFor(root).join("/")}?type=upload&conflict=error`, {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(102 * 1024 * 1024),
    },
    body: "--x--\r\n",
  });
  const rejected = await POST(oversized, context);
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), { error: "Uploads must total 100MB or less" });
});
