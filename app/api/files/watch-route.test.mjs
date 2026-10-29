import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-watch-route-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
// Another copy of the module, as the debug route's bundle holds one.
const { countFileWatches } = await jiti.import("../../../lib/file-watch-registry.ts");
allowFileRoot(root);

const decoder = new TextDecoder();

async function openWatch(filePath, signal) {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const response = await GET(
    new NextRequest("http://localhost/api/files/x?type=watch", signal ? { signal } : undefined),
    { params: Promise.resolve({ path: segments }) },
  );
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(decoder.decode((await reader.read()).value), /^event: connected\n/);
  return reader;
}

test("an open watch stream is counted until the client cancels it", async () => {
  const file = path.join(root, "watched.txt");
  fs.writeFileSync(file, "one");
  const baseline = countFileWatches();
  const reader = await openWatch(file);
  assert.equal(countFileWatches(), baseline + 1);
  await reader.cancel();
  assert.equal(countFileWatches(), baseline);
});

test("a client gone without a cancel lets go of the watch when its request is aborted", async () => {
  const file = path.join(root, "aborted.txt");
  fs.writeFileSync(file, "one");
  const baseline = countFileWatches();
  const client = new AbortController();
  const reader = await openWatch(file, client.signal);
  assert.equal(countFileWatches(), baseline + 1);
  client.abort();
  assert.equal(countFileWatches(), baseline);
  assert.equal((await reader.read()).done, true, "the stream ends with the request");
  await reader.cancel();
  assert.equal(countFileWatches(), baseline, "a later cancel counts nothing twice");
});

test("a watch whose watcher fails is let go once, before the stream ends", async (t) => {
  const file = path.join(root, "failing.txt");
  fs.writeFileSync(file, "one");
  const watchers = [];
  const watch = fs.watch;
  fs.watch = (...args) => {
    const watcher = watch(...args);
    watchers.push(watcher);
    return watcher;
  };
  t.after(() => { fs.watch = watch; });
  const baseline = countFileWatches();
  const reader = await openWatch(file);
  fs.watch = watch;
  assert.equal(watchers.length, 1);
  assert.equal(countFileWatches(), baseline + 1);

  watchers[0].emit("error", new Error("watched directory went away"));
  assert.equal((await reader.read()).done, true);
  assert.equal(countFileWatches(), baseline);
  await reader.cancel();
  assert.equal(countFileWatches(), baseline);
});
