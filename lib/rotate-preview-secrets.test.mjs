import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { rotatePreviewSecrets, getRotationWarning, PRERENDER_MANIFEST } = require(
  "../bin/rotate-preview-secrets.js",
);

const PUBLISHED_PREVIEW = {
  previewModeId: "187a04243912e842766b031c8ae4e039",
  previewModeSigningKey: "a6cb3eb43a40bc5906a7c3b6ea7bee61454ac753c56033ddf559119fd886923b",
  previewModeEncryptionKey: "51cd808625edbab713c49062a44fa8d588fd7da6fbf6186834bc54501ec01858",
};

function makeNextDir(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-rotate-"));
  const nextDir = path.join(dir, ".next");
  fs.mkdirSync(nextDir);
  if (manifest !== undefined) {
    fs.writeFileSync(path.join(nextDir, PRERENDER_MANIFEST), JSON.stringify(manifest));
  }
  return nextDir;
}

function readManifest(nextDir) {
  return JSON.parse(fs.readFileSync(path.join(nextDir, PRERENDER_MANIFEST), "utf8"));
}

test("rotates all three preview secrets away from the published values", () => {
  const nextDir = makeNextDir({
    version: 4,
    routes: {},
    dynamicRoutes: {},
    notFoundRoutes: [],
    preview: { ...PUBLISHED_PREVIEW },
  });

  assert.deepEqual(rotatePreviewSecrets(nextDir), { ok: true });

  const preview = readManifest(nextDir).preview;
  assert.notEqual(preview.previewModeId, PUBLISHED_PREVIEW.previewModeId);
  assert.notEqual(preview.previewModeSigningKey, PUBLISHED_PREVIEW.previewModeSigningKey);
  assert.notEqual(preview.previewModeEncryptionKey, PUBLISHED_PREVIEW.previewModeEncryptionKey);
  // Lengths mirror Next's build-time secrets: 16-byte id, 32-byte keys (hex).
  assert.equal(preview.previewModeId.length, 32);
  assert.equal(preview.previewModeSigningKey.length, 64);
  assert.equal(preview.previewModeEncryptionKey.length, 64);
});

test("preserves the rest of the manifest and leaves no temp files", () => {
  const manifest = {
    version: 4,
    routes: { "/x": { initialRevalidateSeconds: false } },
    dynamicRoutes: {},
    notFoundRoutes: ["/404"],
    preview: { ...PUBLISHED_PREVIEW },
  };
  const nextDir = makeNextDir(manifest);

  rotatePreviewSecrets(nextDir);

  const after = readManifest(nextDir);
  assert.equal(after.version, manifest.version);
  assert.deepEqual(after.routes, manifest.routes);
  assert.deepEqual(after.notFoundRoutes, manifest.notFoundRoutes);
  assert.deepEqual(Object.keys(after), Object.keys(manifest));
  assert.deepEqual(fs.readdirSync(nextDir), [PRERENDER_MANIFEST]);
});

test("produces a different previewModeId on every call", () => {
  const nextDir = makeNextDir({ preview: { ...PUBLISHED_PREVIEW } });
  rotatePreviewSecrets(nextDir);
  const first = readManifest(nextDir).preview.previewModeId;
  rotatePreviewSecrets(nextDir);
  const second = readManifest(nextDir).preview.previewModeId;
  assert.notEqual(first, second);
});

test("reports a reason instead of throwing when the manifest is missing", () => {
  const nextDir = makeNextDir(undefined);
  assert.deepEqual(rotatePreviewSecrets(nextDir), { ok: false, reason: "missing" });
});

test("reports unreadable for malformed JSON", () => {
  const nextDir = makeNextDir(undefined);
  fs.writeFileSync(path.join(nextDir, PRERENDER_MANIFEST), "{ not json");
  const result = rotatePreviewSecrets(nextDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreadable");
});

test("reports unexpected-shape when there is no preview block", () => {
  const nextDir = makeNextDir({ version: 4 });
  assert.deepEqual(rotatePreviewSecrets(nextDir), { ok: false, reason: "unexpected-shape" });
});

test("reports unwritable and leaves the manifest untouched on a read-only dir", () => {
  const nextDir = makeNextDir({ preview: { ...PUBLISHED_PREVIEW } });
  fs.chmodSync(nextDir, 0o500);
  try {
    const result = rotatePreviewSecrets(nextDir);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unwritable");
  } finally {
    fs.chmodSync(nextDir, 0o700);
  }
  assert.equal(readManifest(nextDir).preview.previewModeId, PUBLISHED_PREVIEW.previewModeId);
});

test("the rotation warning names the bypass header so the risk is visible", () => {
  const warning = getRotationWarning("unwritable");
  assert.match(warning, /x-prerender-revalidate/);
  assert.match(warning, /not writable/);
});
