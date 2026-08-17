import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isPakeInterceptedDownload } = await jiti.import(
  "./pake-download-extensions.ts",
);

test("extensions in the Pake hijack set are intercepted", () => {
  for (const name of [
    "report.docx",
    "sheet.xlsx",
    "doc.pdf",
    "archive.zip",
    "data.csv",
    "run.sh",
    "font.ttf",
    "model.psd",
    "image.raw",
    "setup.exe",
  ]) {
    assert.equal(
      isPakeInterceptedDownload(`/home/user/project/${name}`),
      true,
      name,
    );
  }
});

test("extensions outside the Pake hijack set are not intercepted", () => {
  for (const name of [
    "README.md",
    "package.json",
    "index.html",
    "script.js",
    "style.css",
    "config.yaml",
    "notes.txt.multipart", // multi-dot names take the final segment, not in the set
  ]) {
    assert.equal(
      isPakeInterceptedDownload(`/home/user/project/${name}`),
      false,
      name,
    );
  }
});

test("previewable media types are not intercepted", () => {
  for (const name of [
    "photo.png",
    "pic.jpg",
    "clip.mp4",
    "audio.mp3",
    "vector.svg",
  ]) {
    assert.equal(
      isPakeInterceptedDownload(`/home/user/project/${name}`),
      false,
      name,
    );
  }
});

test("files without an extension are not intercepted", () => {
  assert.equal(isPakeInterceptedDownload("/home/user/project/Makefile"), false);
  assert.equal(isPakeInterceptedDownload(""), false);
});
