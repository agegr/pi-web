import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./[...path]/route.ts");

function routeContext(filePath) {
  return { params: Promise.resolve({ path: filePath.replace(/^\/+/, "").split("/") }) };
}

function urlFor(filePath, type) {
  const encoded = filePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `http://localhost/api/files/${encoded}?type=${type}`;
}

function postVersions(root, paths) {
  return new NextRequest(urlFor(root, "directory-versions"), {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paths }),
  });
}

test("directory listings and bounded batch validation expose change-only versions", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-directory-versions-"));
  const nested = join(root, "nested");
  const outside = join(dirname(root), `${root.split("/").pop()}-outside`);
  mkdirSync(nested);
  mkdirSync(outside);
  const previousAllowedRootsCache = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = {
    roots: new Set([root]),
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previousAllowedRootsCache;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const listing = await GET(
    new NextRequest(urlFor(nested, "list"), { headers: { host: "localhost" } }),
    routeContext(nested),
  );
  assert.equal(listing.status, 200);
  assert.equal(typeof (await listing.json()).directoryVersion, "string");

  const first = await POST(postVersions(root, [nested]), routeContext(root));
  assert.equal(first.status, 200);
  const firstVersion = (await first.json()).versions[nested];
  assert.equal(typeof firstVersion, "string");

  await new Promise((resolve) => setTimeout(resolve, 20));
  writeFileSync(join(nested, "new.txt"), "new\n");
  const changed = await POST(postVersions(root, [nested]), routeContext(root));
  assert.equal(changed.status, 200);
  assert.notEqual((await changed.json()).versions[nested], firstVersion);

  const denied = await POST(postVersions(root, [outside]), routeContext(root));
  assert.equal(denied.status, 403);

  const oversized = await POST(
    postVersions(root, Array.from({ length: 129 }, () => nested)),
    routeContext(root),
  );
  assert.equal(oversized.status, 400);
});
