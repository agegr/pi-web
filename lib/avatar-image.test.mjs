import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const {
  AVATAR_IMAGE_MAX_SIZE,
  computeAvatarTargetSize,
  detectAvatarSourceMime,
  resizeAvatarDataUrl,
} = await jiti.import("./avatar-image.ts");

test("computeAvatarTargetSize shrinks the longest edge to maxSize and preserves aspect ratio", () => {
  assert.deepEqual(computeAvatarTargetSize(256, 128, 64), { width: 64, height: 32 });
  assert.deepEqual(computeAvatarTargetSize(100, 200, 50), { width: 25, height: 50 });
});

test("computeAvatarTargetSize returns the original size when the source already fits", () => {
  assert.deepEqual(computeAvatarTargetSize(64, 64, 128), { width: 64, height: 64 });
  assert.deepEqual(computeAvatarTargetSize(80, 40, 128), { width: 80, height: 40 });
});

test("computeAvatarTargetSize defaults to AVATAR_IMAGE_MAX_SIZE", () => {
  assert.equal(AVATAR_IMAGE_MAX_SIZE, 128);
  assert.deepEqual(computeAvatarTargetSize(1000, 500), { width: 128, height: 64 });
});

test("computeAvatarTargetSize falls back to a square when inputs are invalid", () => {
  for (const [w, h] of [[0, 0], [-1, 100], [Number.NaN, 50]]) {
    const target = computeAvatarTargetSize(w, h);
    assert.equal(target.width, AVATAR_IMAGE_MAX_SIZE);
    assert.equal(target.height, AVATAR_IMAGE_MAX_SIZE);
  }
});

test("detectAvatarSourceMime extracts and lowercases the source MIME", () => {
  assert.equal(detectAvatarSourceMime("data:image/png;base64,xx"), "image/png");
  assert.equal(detectAvatarSourceMime("data:IMAGE/JPEG;base64,xx"), "image/jpeg");
  assert.equal(detectAvatarSourceMime("data:image/webp;base64,xx"), "image/webp");
  assert.equal(detectAvatarSourceMime("not-a-data-url"), "image/png");
});

test("resizeAvatarDataUrl uses the injected loadBitmap and createCanvas dependencies", async () => {
  let drawCalls = 0;
  const sourceDataUrl = "data:image/png;base64,abc";
  const deps = {
    loadBitmap: async () => {
      return { width: 1024, height: 512, close() {} };
    },
    createCanvas: (width, height) => {
      const ctx = {
        imageSmoothingQuality: "low",
        drawImage(_image, _dx, _dy, dw, dh) {
          drawCalls += 1;
          // Capture the target size used during the draw.
          this.lastDraw = { dw, dh, width, height };
        },
      };
      return {
        width,
        height,
        getContext: (kind) => (kind === "2d" ? ctx : null),
        toDataURL: (mime) => `data:${mime};base64,ENCODED-${width}x${height}`,
      };
    },
  };

  const result = await resizeAvatarDataUrl(sourceDataUrl, 128, deps);
  assert.equal(drawCalls, 1);
  assert.equal(result, "data:image/png;base64,ENCODED-128x64");
});

test("resizeAvatarDataUrl preserves the source size when it already fits", async () => {
  const deps = {
    loadBitmap: async () => ({ width: 64, height: 64, close() {} }),
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({
        imageSmoothingQuality: "low",
        drawImage() {},
      }),
      toDataURL: (mime) => `data:${mime};base64,NOOP-${width}x${height}`,
    }),
  };

  const result = await resizeAvatarDataUrl("data:image/webp;base64,abc", 128, deps);
  assert.equal(result, "data:image/webp;base64,NOOP-64x64");
});

test("resizeAvatarDataUrl surfaces a clear error when the canvas context is unavailable", async () => {
  const deps = {
    loadBitmap: async () => ({ width: 64, height: 64, close() {} }),
    createCanvas: () => ({
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => "data:image/png;base64,unused",
    }),
  };

  await assert.rejects(
    () => resizeAvatarDataUrl("data:image/png;base64,abc", 128, deps),
    /2D canvas context/,
  );
});