import assert from "node:assert/strict";
import test from "node:test";
import { getFileExt, getImageMime, getAudioMime, getVideoMime, documentPreviewKind } from "./file-types.ts";

test("extensionless files named after media formats stay ordinary files", () => {
  for (const path of ["/project/png", "C:\\project\\pdf", "/project/mp3", "/project/mp4", "/project/.png"]) {
    assert.equal(getFileExt(path), "");
    assert.equal(getImageMime(path), null);
    assert.equal(getAudioMime(path), null);
    assert.equal(getVideoMime(path), null);
    assert.equal(documentPreviewKind(path), null);
  }
  assert.equal(getFileExt("/project/.cover.PNG"), "png");
  assert.equal(getFileExt("/project/cover.PNG"), "png");
});
