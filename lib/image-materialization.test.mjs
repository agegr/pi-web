import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { ImageAttachmentStore, IMAGE_IDLE_TTL_MS, appendImagePaths } = await jiti.import("./image-materialization.ts");
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 0x80, 0xff, 0xd9]);
const jpeg = { type: "image", mimeType: "image/jpeg", data: bytes.toString("base64") };

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-web-image-test-"));
  const store = new ImageAttachmentStore({ root, ...options });
  t.after(async () => { store.disposeSync(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store };
}

test("materializes binary bytes with MIME extensions, private permissions and unique batches", async (t) => {
  const { store } = await fixture(t);
  const batches = await Promise.all([
    store.materialize([jpeg, { ...jpeg, mimeType: "image/png" }]),
    store.materialize([jpeg]),
  ]);
  const paths = batches.flatMap(batch => batch.paths);
  assert.equal(new Set(paths).size, 3);
  assert.deepEqual(paths.map(extname), [".jpg", ".png", ".jpg"]);
  assert.notEqual(dirname(paths[0]), dirname(paths[2]));
  for (const path of paths) {
    assert.deepEqual(await fs.readFile(path), bytes);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(dirname(path))).mode & 0o777, 0o700);
    }
  }
  await batches[0].rollback();
  await assert.rejects(fs.stat(paths[0]), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(paths[2]), bytes);
});

test("rejects invalid inputs before creating files", async (t) => {
  const { store, root } = await fixture(t);
  for (const images of [
    [{ ...jpeg, data: "broken!" }],
    [{ ...jpeg, mimeType: "image/../../bad" }],
    [{ ...jpeg, mimeType: "image/unknown" }],
    Array.from({ length: 11 }, () => jpeg),
    [{ ...jpeg, data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }],
  ]) await assert.rejects(store.materialize(images));
  assert.deepEqual(await fs.readdir(root), []);
});

test("a failed batch removes partial files without deleting another batch", async (t) => {
  const { store } = await fixture(t);
  const kept = await store.materialize([jpeg]);
  const write = fs.writeFile;
  let calls = 0;
  const mocked = t.mock.method(fs, "writeFile", async (...args) => {
    await write(...args);
    if (++calls === 2) throw new Error("fixture disk full");
  });
  await assert.rejects(store.materialize([jpeg, jpeg]), /fixture disk full/);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(kept.paths[0]), bytes);
  assert.equal((await fs.readdir(dirname(dirname(kept.paths[0])))).length, 1);
});

test("idle cleanup protects active work and later prompts, then expires temporary paths", async (t) => {
  let now = Date.now();
  let busy = false;
  const { store } = await fixture(t, { now: () => now, isBusy: () => busy });
  const batch = await store.materialize([jpeg]);
  now += IMAGE_IDLE_TTL_MS + 1;
  busy = true;
  await store.collect();
  assert.deepEqual(await fs.readFile(batch.paths[0]), bytes);
  busy = false;
  now += IMAGE_IDLE_TTL_MS - 1;
  store.touch();
  await store.collect();
  assert.deepEqual(await fs.readFile(batch.paths[0]), bytes);
  now += IMAGE_IDLE_TTL_MS + 1;
  await store.collect();
  await assert.rejects(fs.stat(batch.paths[0]), { code: "ENOENT" });
  const next = await store.materialize([jpeg]);
  assert.deepEqual(await fs.readFile(next.paths[0]), bytes);
});

test("orphan cleanup skips live owners, unrelated directories, and symlinks", async (t) => {
  const now = Date.now();
  const { root, store } = await fixture(t, { now: () => now, isProcessAlive: pid => pid === process.pid });
  const dead = join(root, "pi-web-clipboard-v1-999999-ABCdef");
  const live = join(root, `pi-web-clipboard-v1-${process.pid}-ABCdef`);
  const unrelated = join(root, "other-app");
  for (const directory of [dead, live, unrelated]) {
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(join(directory, "keep"), "fixture");
    const old = new Date(now - IMAGE_IDLE_TTL_MS - 1);
    await fs.utimes(directory, old, old);
  }
  const link = join(root, "pi-web-clipboard-v1-999998-ABCdef");
  await fs.symlink(unrelated, link);
  await store.collect();
  await assert.rejects(fs.stat(dead), { code: "ENOENT" });
  assert.equal(await fs.readFile(join(live, "keep"), "utf8"), "fixture");
  assert.equal(await fs.readFile(join(unrelated, "keep"), "utf8"), "fixture");
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
});

test("path annotation preserves slash command token and safely quotes paths", () => {
  assert.equal(appendImagePaths("hello", []), "hello");
  const annotated = appendImagePaths("/command", ["/tmp/a b.jpg", "/tmp/a\nb.png"]);
  assert.equal(annotated.split(" ")[0], "/command");
  assert.ok(annotated.includes(JSON.stringify("/tmp/a b.jpg")));
  assert.ok(annotated.includes(JSON.stringify("/tmp/a\nb.png")));
});

test("cleanup waits for an in-flight batch and starts its lifetime after writing", async (t) => {
  let now = Date.now();
  const { store } = await fixture(t, { now: () => now });
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const write = fs.writeFile;
  t.mock.method(fs, "writeFile", async (...args) => {
    started();
    await gate;
    return write(...args);
  });
  const pending = store.materialize([jpeg]);
  await entered;
  now += IMAGE_IDLE_TTL_MS + 1;
  const collected = store.collect();
  release();
  const batch = await pending;
  await collected;
  assert.deepEqual(await fs.readFile(batch.paths[0]), bytes);
});

test("normal process exit cleans its files without being kept alive by the GC timer", async (t) => {
  const { root } = await fixture(t);
  const code = `
    const { createJiti } = require("jiti");
    const jiti = createJiti(process.cwd() + "/image-exit-test.mjs");
    (async () => {
      const { getImageAttachmentStore } = await jiti.import("./lib/image-materialization.ts");
      const batch = await getImageAttachmentStore(() => false).materialize(${JSON.stringify([jpeg])});
      console.log(JSON.stringify(batch.paths));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", code], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
    timeout: 15_000,
  });
  const paths = JSON.parse(stdout);
  assert.equal(paths.length, 1);
  await assert.rejects(fs.stat(paths[0]), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(root), []);
});
