import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  IMAGE_JPEG_QUALITY_DEFAULT,
  IMAGE_JPEG_QUALITY_MAX,
  IMAGE_JPEG_QUALITY_MIN,
  IMAGE_MAX_SIDE_DEFAULT,
  IMAGE_MAX_SIDE_MAX,
  IMAGE_MAX_SIDE_MIN,
  clampImageJpegQuality,
  clampImageMaxSide,
  getImageCompressionPreferences,
} = await jiti.import("@/hooks/useImageCompression");

test("image compression clamps fall back to defaults and stay in range", () => {
  assert.equal(clampImageMaxSide(undefined), IMAGE_MAX_SIDE_DEFAULT);
  assert.equal(clampImageMaxSide("not a number"), IMAGE_MAX_SIDE_DEFAULT);
  assert.equal(clampImageMaxSide(10), IMAGE_MAX_SIDE_MIN);
  assert.equal(clampImageMaxSide(99999), IMAGE_MAX_SIDE_MAX);
  assert.equal(clampImageMaxSide(2000.6), 2001);

  assert.equal(clampImageJpegQuality(undefined), IMAGE_JPEG_QUALITY_DEFAULT);
  assert.equal(clampImageJpegQuality("not a number"), IMAGE_JPEG_QUALITY_DEFAULT);
  assert.equal(clampImageJpegQuality(0.1), IMAGE_JPEG_QUALITY_MIN);
  assert.equal(clampImageJpegQuality(2), IMAGE_JPEG_QUALITY_MAX);
  assert.equal(clampImageJpegQuality(0.955), 0.96);
});

test("image compression preferences default without a browser", () => {
  assert.deepEqual(getImageCompressionPreferences(), {
    maxSide: IMAGE_MAX_SIDE_DEFAULT,
    quality: IMAGE_JPEG_QUALITY_DEFAULT,
  });
});
