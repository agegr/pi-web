import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const {
  AVATAR_UPLOAD_ACCEPTED_MIME_TYPES,
  processAvatarUpload,
  AVATAR_DATA_URL_MAX_BYTES,
} = await jiti.import("./avatar-upload.ts");

// node 22+ ships a global File. Older runtimes would fall back to undefined
// here, in which case these tests can't run.
if (typeof File === "undefined") {
  throw new Error("File global is required to run avatar-upload tests");
}

function makeFile(type, name = "avatar.bin", bytes = [0]) {
  return new File([new Uint8Array(bytes)], name, { type });
}

const SAMPLE_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

test("AVATAR_UPLOAD_ACCEPTED_MIME_TYPES only allows PNG, JPEG, and WebP", () => {
  assert.deepEqual([...AVATAR_UPLOAD_ACCEPTED_MIME_TYPES], [
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  // SVG is intentionally excluded so the upload pipeline rejects SVG even
  // when the user renames the file.
  assert.equal(AVATAR_UPLOAD_ACCEPTED_MIME_TYPES.includes("image/svg+xml"), false);
});

// --- rejection paths ---

test("processAvatarUpload rejects SVG and other unsupported MIME types", async () => {
  for (const type of ["image/svg+xml", "image/gif", "text/plain", "application/json", ""]) {
    const result = await processAvatarUpload(makeFile(type), {
      readDataUrl: async () => SAMPLE_DATA_URL,
      resizeDataUrl: async (url) => url,
    });
    assert.equal(result.ok, false, `expected failure for ${type}`);
    if (!result.ok) {
      assert.match(result.reason, /Unsupported/);
    }
  }
});

test("processAvatarUpload rejects an undecodable image without touching state", async () => {
  // Simulate a File whose contents can't be decoded by the resize step
  // (e.g. a mislabeled SVG with an image/png MIME).
  let resizeCalled = false;
  const result = await processAvatarUpload(makeFile("image/png"), {
    readDataUrl: async () => "data:image/png;base64,XXXXXX",
    resizeDataUrl: async () => {
      resizeCalled = true;
      throw new Error("Could not decode avatar image");
    },
  });
  assert.equal(resizeCalled, true, "resize must be attempted before rejection");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /Could not decode/i);
    assert.match(result.reason, /decode avatar image/);
  }
});

test("processAvatarUpload rejects an oversized encoded data URL after resize", async () => {
  const huge = "data:image/png;base64," + "A".repeat(AVATAR_DATA_URL_MAX_BYTES + 1);
  const result = await processAvatarUpload(makeFile("image/png"), {
    readDataUrl: async () => huge,
    resizeDataUrl: async (url) => url,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /encoded size limit|exceeds/);
  }
});

test("processAvatarUpload rejects an empty resize result", async () => {
  const result = await processAvatarUpload(makeFile("image/png"), {
    readDataUrl: async () => SAMPLE_DATA_URL,
    resizeDataUrl: async () => "",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /empty/);
  }
});

// --- success path ---

test("processAvatarUpload returns the resized data URL on success", async () => {
  const result = await processAvatarUpload(makeFile("image/png"), {
    readDataUrl: async () => SAMPLE_DATA_URL,
    resizeDataUrl: async () => SAMPLE_DATA_URL,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.dataUrl, SAMPLE_DATA_URL);
  }
});
