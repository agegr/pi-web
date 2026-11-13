import assert from "node:assert/strict";
import test from "node:test";
import { getImageMime, getAudioMime, getVideoMime, getDocumentMime, isImagePath } from "./file-types.ts";

test("unlisted extensions cannot resolve to Object prototype properties", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    for (const mime of [getImageMime, getAudioMime, getVideoMime, getDocumentMime]) {
      assert.equal(mime(`/project/file.${name}`), null);
    }
    assert.equal(isImagePath(`/project/file.${name}`), false);
  }
});
