import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-types.ts");
}

test("detects image, audio, and document preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(getDocumentMime("/tmp/report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
});

test("classifies previewable extensions", async () => {
  const { isPreviewableExtension, getLanguageForPath } = await loadSubject();

  assert.equal(isPreviewableExtension("/tmp/report.html"), true);
  assert.equal(isPreviewableExtension("/tmp/notes.md"), true);
  assert.equal(isPreviewableExtension("/tmp/shot.PNG"), true);
  assert.equal(isPreviewableExtension("/tmp/voice.opus"), true);
  assert.equal(isPreviewableExtension("/tmp/paper.pdf"), true);

  assert.equal(isPreviewableExtension("/usr/bin"), false);
  assert.equal(isPreviewableExtension("/tmp/data.xyz"), false);

  assert.equal(getLanguageForPath("/tmp/a.tsx"), "typescript");
  assert.equal(getLanguageForPath("/tmp/Dockerfile"), "dockerfile");
  assert.equal(getLanguageForPath("/tmp/.env.local"), "bash");
  assert.equal(getLanguageForPath("C:\\Users\\me\\Makefile"), "makefile");
  assert.equal(getLanguageForPath("/tmp/unknown.xyz"), "text");
});
