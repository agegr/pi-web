import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import JSZip from "jszip";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");

function routeContext(filePath) {
  return { params: Promise.resolve({ path: filePath.replace(/^\/+/, "").split("/") }) };
}

function request(filePath, type, headers = {}) {
  const encoded = filePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return new NextRequest(`http://localhost/api/files/${encoded}?type=${type}`, { headers });
}

async function createDocx(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
    </w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("authorized file reads expose versions and honor ETag only after authorization", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-file-version-route-"));
  const filePath = join(directory, "sample.txt");
  const outsidePath = join(dirname(directory), `${directory.split("/").pop()}-outside.txt`);
  writeFileSync(filePath, "first version");
  writeFileSync(outsidePath, "outside");

  const previousAllowedRootsCache = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = {
    roots: new Set([directory]),
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previousAllowedRootsCache;
    rmSync(directory, { recursive: true, force: true });
    rmSync(outsidePath, { force: true });
  });

  const first = await GET(request(filePath, "read"), routeContext(filePath));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const etag = first.headers.get("etag");
  assert.equal(firstBody.content, "first version");
  assert.equal(firstBody.version.exists, true);
  assert.equal(firstBody.version.etag, etag);
  assert.equal(first.headers.get("cache-control"), "private, no-cache");
  assert.ok(first.headers.get("last-modified"));

  const unchanged = await GET(
    request(filePath, "read", { "If-None-Match": etag }),
    routeContext(filePath),
  );
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");

  const unchangedByDate = await GET(
    request(filePath, "read", { "If-Modified-Since": first.headers.get("last-modified") }),
    routeContext(filePath),
  );
  assert.equal(unchangedByDate.status, 304);

  const etagTakesPrecedence = await GET(
    request(filePath, "read", {
      "If-None-Match": '"different"',
      "If-Modified-Since": "Tue, 19 Jan 2038 03:14:07 GMT",
    }),
    routeContext(filePath),
  );
  assert.equal(etagTakesPrecedence.status, 200);

  const denied = await GET(
    request(outsidePath, "read", { "If-None-Match": etag }),
    routeContext(outsidePath),
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("etag"), null);

  writeFileSync(filePath, "second version with a different size");
  const changed = await GET(
    request(filePath, "read", { "If-None-Match": etag }),
    routeContext(filePath),
  );
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  assert.notEqual(changedBody.version.etag, etag);
  assert.equal(changedBody.content, "second version with a different size");

  const meta = await GET(request(filePath, "meta"), routeContext(filePath));
  const metaBody = await meta.json();
  assert.equal(meta.headers.get("etag"), changedBody.version.etag);
  assert.equal(metaBody.version.etag, changedBody.version.etag);
});

test("DOCX preview cache remains versioned and cannot bypass revoked authorization", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-docx-version-route-"));
  const filePath = join(directory, "sample.docx");
  writeFileSync(filePath, await createDocx("cached preview"));

  const previousAllowedRootsCache = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = {
    roots: new Set([directory]),
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previousAllowedRootsCache;
    rmSync(directory, { recursive: true, force: true });
  });

  const first = await GET(request(filePath, "preview"), routeContext(filePath));
  assert.equal(first.status, 200);
  assert.match(await first.text(), /cached preview/);
  const etag = first.headers.get("etag");
  assert.ok(etag);

  const cached = await GET(request(filePath, "preview"), routeContext(filePath));
  assert.equal(cached.status, 200);
  assert.match(await cached.text(), /cached preview/);
  assert.equal(cached.headers.get("etag"), etag);

  const unchanged = await GET(
    request(filePath, "preview", { "If-None-Match": etag }),
    routeContext(filePath),
  );
  assert.equal(unchanged.status, 304);

  globalThis.__piAllowedRootsCache = {
    roots: new Set(),
    expiresAt: Date.now() + 60_000,
  };
  const denied = await GET(
    request(filePath, "preview", { "If-None-Match": etag }),
    routeContext(filePath),
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("etag"), null);
});
