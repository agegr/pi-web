import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

// No user sessions, files or credentials participate in these requests.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-cache-")));
const agentDir = path.join(root, "agent");
const workspace = path.join(root, "workspace");
const outside = path.join(root, "outside.txt");
fs.mkdirSync(agentDir);
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, "sample.txt"), "synthetic file content\n");
fs.writeFileSync(path.join(workspace, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
fs.writeFileSync(outside, "not allowed");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousPassword = process.env.PI_WEB_PASSWORD;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_WEB_PASSWORD = "synthetic-file-cache-password";
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = previousPassword;
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { proxy } = await jiti.import("../../../proxy.ts");
allowFileRoot(workspace);

function fileRequest(filePath, query, { method = "GET", headers = {} } = {}) {
  const encoded = encodeFilePathForApi(filePath);
  return {
    request: new NextRequest(`http://localhost/api/files/${encoded}?${query}`, {
      method,
      headers: { host: "localhost", "sec-fetch-site": "same-origin", ...headers },
    }),
    context: { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) },
  };
}

async function get(filePath, query, options) {
  const { request, context } = fileRequest(filePath, query, options);
  return GET(request, context);
}

function assertPrivateJson(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
}

test("text reads, metadata and directory listings explicitly refuse storage", async () => {
  const read = await get(path.join(workspace, "sample.txt"), "type=read");
  assertPrivateJson(read, 200);
  assert.equal((await read.json()).content, "synthetic file content\n");

  const meta = await get(path.join(workspace, "sample.txt"), "type=meta");
  assertPrivateJson(meta, 200);
  assert.equal((await meta.json()).mime, "text/plain");

  const listing = await get(workspace, "type=list");
  assertPrivateJson(listing, 200);
  assert.deepEqual((await listing.json()).entries.map(entry => entry.name), ["image.svg", "sample.txt"]);
});

test("JSON refusals have the same private no-store policy", async () => {
  for (const [filePath, query, status] of [
    [outside, "type=read", 403],
    [path.join(workspace, "missing.txt"), "type=read", 404],
    [workspace, "type=read", 400],
    [path.join(workspace, "sample.txt"), "type=invalid", 400],
    [path.join(workspace, "sample.txt"), "type=read&offset=-1", 400],
    [path.join(workspace, "sample.txt"), "type=read&offset=999", 400],
    [path.join(workspace, "sample.txt"), "type=preview", 400],
  ]) {
    assertPrivateJson(await get(filePath, query), status);
  }
});

test("JSON failures and oversized preview refusals also refuse storage", async () => {
  const { request } = fileRequest(workspace, "type=list");
  const failed = await GET(request, { params: Promise.reject(new Error("synthetic params failure")) });
  assertPrivateJson(failed, 500);

  const image = path.join(workspace, "large.svg");
  fs.writeFileSync(image, "");
  fs.truncateSync(image, 10 * 1024 * 1024 + 1);
  try {
    assertPrivateJson(await get(image, "type=read"), 413);
  } finally {
    fs.rmSync(image);
  }
});

// Direct handler coverage only; Next HTTP HEAD handling is not exercised here.
test("a HEAD request passed directly to GET keeps the JSON cache policy", async () => {
  assertPrivateJson(await get(path.join(workspace, "sample.txt"), "type=meta", { method: "HEAD" }), 200);
});

test("binary streaming, Range and SVG security headers are unchanged", async () => {
  const svg = path.join(workspace, "image.svg");
  for (const [query, range, status] of [
    ["type=read", undefined, 200],
    ["type=read", "bytes=0-3", 206],
    ["type=read", "bytes=999-", 416],
    ["type=download", undefined, 200],
  ]) {
    const response = await get(svg, query, { headers: range ? { range } : {} });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    if (query === "type=download") assert.match(response.headers.get("content-disposition"), /^attachment;/);
    await response.arrayBuffer();
  }
});

test("watch SSE keeps its existing policy and can be cancelled", async () => {
  const response = await get(path.join(workspace, "sample.txt"), "type=watch");
  try {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  } finally {
    await response.body.cancel();
  }
});

test("an unauthenticated file request is still rejected before the handler", () => {
  const { request } = fileRequest(path.join(workspace, "sample.txt"), "type=read");
  const response = proxy(request);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-middleware-next"), null);
});
