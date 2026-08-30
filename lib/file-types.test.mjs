import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-types.ts");
}

test("detects image, audio, video, and document preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    getVideoMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
    isVideoPath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(getDocumentMime("/tmp/report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(getVideoMime("/tmp/clip.mp4"), "video/mp4");
  assert.equal(getVideoMime("C:\\Users\\me\\recording.MOV"), "video/quicktime");
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isVideoPath("/tmp/clip.webm"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);
});

test("webm is video while weba stays audio", async () => {
  const { getAudioMime, getVideoMime, isAudioPath, isVideoPath } = await loadSubject();

  assert.equal(getAudioMime("/tmp/voice.weba"), "audio/webm");
  assert.equal(isAudioPath("/tmp/voice.weba"), true);
  assert.equal(getVideoMime("/tmp/recording.webm"), "video/webm");
  assert.equal(isVideoPath("/tmp/recording.webm"), true);
  assert.equal(isAudioPath("/tmp/recording.webm"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
});
