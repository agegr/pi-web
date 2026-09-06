import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf('if (type === "watch")');
const end = source.indexOf("// type === \"list\"", start);
assert.notEqual(start, -1, "watch route not found");
assert.notEqual(end, -1, "watch route end not found");
const watchBlock = source.slice(start, end);
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");

function createSseCollector(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let stopped = false;

  const pump = (async () => {
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    }
  })();

  return {
    async waitFor(predicate, timeoutMs = 5_000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const match = events.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for SSE event; received ${JSON.stringify(events)}`);
    },
    checkpoint() {
      return events.length;
    },
    async close() {
      stopped = true;
      await reader.cancel();
      await pump.catch(() => {});
    },
    events,
  };
}

test("file watching survives same-path replacement", () => {
  assert.match(watchBlock, /watcher = fs\.watch\(watchedDirectory/);
  assert.match(watchBlock, /samePath\(path\.join\(watchedDirectory, changedName\.toString\(\)\), filePath\)/);
  assert.match(watchBlock, /nextVersion = createFileVersion\(fs\.statSync\(filePath\)\)/);
  assert.match(watchBlock, /nextVersion\.etag === lastVersion\.etag/);
  assert.match(watchBlock, /version: nextVersion/);
});

test("a missing target can be watched after its parent is authorized", () => {
  assert.match(source, /if \(type !== "watch"\)[\s\S]*error: "Not found"/);
  assert.match(source, /const existingAuthorizationPath = stat \? filePath : path\.dirname\(filePath\)/);
  assert.match(watchBlock, /lastVersion = version/);
});

test("connected is emitted only after the watcher exists", () => {
  const watcher = watchBlock.indexOf("watcher = fs.watch");
  const connected = watchBlock.indexOf('send("connected"');
  assert.ok(watcher >= 0, "watcher creation missing");
  assert.ok(connected > watcher, "connected emitted before watcher creation");
});

test("runtime watcher observes writes, atomic replacement, deletion, and recreation", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-watch-route-"));
  const filePath = join(directory, "watched.txt");
  const replacementPath = join(directory, "replacement.tmp");
  writeFileSync(filePath, "initial");

  const previousAllowedRootsCache = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = {
    roots: new Set([directory]),
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previousAllowedRootsCache;
    rmSync(directory, { recursive: true, force: true });
  });

  const pathSegments = filePath.replace(/^\/+/, "").split("/");
  const response = await GET(
    new NextRequest(`http://localhost/api/files/${pathSegments.map(encodeURIComponent).join("/")}?type=watch`),
    { params: Promise.resolve({ path: pathSegments }) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Server-Timing") ?? "", /auth;dur=\d+\.\d/);
  assert.ok(response.body);

  const collector = createSseCollector(response.body);
  t.after(() => collector.close());
  const connected = await collector.waitFor((event) => event.event === "connected");
  assert.equal(connected.data.version.exists, true);
  assert.equal(connected.data.version.size, 7);
  assert.match(connected.data.version.etag, /^"fv1-[A-Za-z0-9_-]+"$/);

  let checkpoint = collector.checkpoint();
  writeFileSync(filePath, "ordinary-write");
  const ordinary = await collector.waitFor((event, index) => (
    index >= checkpoint && event.event === "change" && event.data.size === 14
  ));
  assert.equal(ordinary.data.version.exists, true);
  assert.equal(ordinary.data.version.size, 14);

  checkpoint = collector.checkpoint();
  writeFileSync(replacementPath, "atomic-replacement");
  renameSync(replacementPath, filePath);
  const replacement = await collector.waitFor((event, index) => (
    index >= checkpoint && event.event === "change" && event.data.size === 18
  ));
  assert.equal(replacement.data.version.exists, true);
  assert.notEqual(replacement.data.version.etag, ordinary.data.version.etag);

  checkpoint = collector.checkpoint();
  unlinkSync(filePath);
  const deleted = await collector.waitFor((event, index) => (
    index >= checkpoint && event.event === "change" && event.data.size === 0
  ));
  assert.equal(deleted.data.version.exists, false);

  checkpoint = collector.checkpoint();
  writeFileSync(filePath, "recreated-file");
  const recreated = await collector.waitFor((event, index) => (
    index >= checkpoint && event.event === "change" && event.data.size === 14
  ));
  assert.equal(recreated.data.version.exists, true);
  assert.notEqual(recreated.data.version.etag, deleted.data.version.etag);
});

test("runtime watcher handshakes a missing file before its creation", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-watch-missing-"));
  const filePath = join(directory, "later.txt");
  const previousAllowedRootsCache = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = {
    roots: new Set([directory]),
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previousAllowedRootsCache;
    rmSync(directory, { recursive: true, force: true });
  });

  const pathSegments = filePath.replace(/^\/+/, "").split("/");
  const response = await GET(
    new NextRequest(`http://localhost/api/files/${pathSegments.map(encodeURIComponent).join("/")}?type=watch`),
    { params: Promise.resolve({ path: pathSegments }) },
  );
  assert.equal(response.status, 200);
  assert.ok(response.body);

  const collector = createSseCollector(response.body);
  t.after(() => collector.close());
  const connected = await collector.waitFor((event) => event.event === "connected");
  assert.equal(connected.data.version.exists, false);

  const checkpoint = collector.checkpoint();
  writeFileSync(filePath, "created later");
  const created = await collector.waitFor((event, index) => (
    index >= checkpoint && event.event === "change" && event.data.version?.exists === true
  ));
  assert.equal(created.data.version.size, 13);
  assert.notEqual(created.data.version.etag, connected.data.version.etag);
});
