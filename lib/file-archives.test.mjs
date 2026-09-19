import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./file-archives.ts");
}

test("isArchivePath matches archive extensions only", async () => {
  const { isArchivePath } = await loadSubject();

  assert.ok(isArchivePath("backup.zip"));
  assert.ok(isArchivePath("data.tar.gz"));
  assert.ok(isArchivePath("data.tgz"));
  assert.ok(isArchivePath("dump.TAR.BZ2"));
  assert.ok(isArchivePath("日志.tar.xz"));
  assert.ok(!isArchivePath("photo.png"));
  assert.ok(!isArchivePath("archive.zip.bak"));
  assert.ok(!isArchivePath("targz"));
});

test("archiveStem strips single and double extensions", async () => {
  const { archiveStem } = await loadSubject();

  assert.equal(archiveStem("project.zip"), "project");
  assert.equal(archiveStem("backup.tar.gz"), "backup");
  assert.equal(archiveStem("photos.tar.bz2"), "photos");
  assert.equal(archiveStem("data.TGZ"), "data");
  assert.equal(archiveStem("weird.tar"), "weird");
  assert.equal(archiveStem("no-extension"), "no-extension_extracted");
});

test("argument builders scope archives to a single top-level entry", async () => {
  const { buildExtractArgs, buildZipArgs } = await loadSubject();

  assert.deepEqual(buildExtractArgs("/ws/a.zip", "/ws/a"), ["-xf", "/ws/a.zip", "-C", "/ws/a"]);
  const zipArgs = buildZipArgs("/ws/folder.zip", "/ws", "folder");
  assert.deepEqual(zipArgs, ["--format", "zip", "-cf", "/ws/folder.zip", "-C", "/ws", "--", "folder"]);
});

const hasBsdtar = (() => {
  try {
    execFileSync("bsdtar", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("compressToZip then extractArchive round-trips a directory", { skip: !hasBsdtar }, async () => {
  const { compressToZip, extractArchive } = await loadSubject();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-archive-"));
  try {
    const dir = path.join(workspace, "项目文件夹");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "main.txt"), "hello archive\n");
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "inner.txt"), "inner");

    const zipResult = await compressToZip(dir, new Set([workspace]));
    assert.ok(zipResult.ok, `compress failed: ${zipResult.ok ? "" : zipResult.error}`);
    const zipPath = path.join(workspace, "项目文件夹.zip");
    assert.ok(fs.existsSync(zipPath));

    const extractResult = await extractArchive(zipPath, new Set([workspace]));
    assert.ok(extractResult.ok, `extract failed: ${extractResult.ok ? "" : extractResult.error}`);
    // The original folder still occupies the plain stem, so extraction
    // auto-numbers its destination as 项目文件夹-1.
    const extractedInto = extractResult.ok ? extractResult.extractedTo : "";
    assert.ok(fs.existsSync(path.join(extractedInto, "项目文件夹", "main.txt")));
    assert.equal(
      fs.readFileSync(path.join(extractedInto, "项目文件夹", "nested", "inner.txt"), "utf8"),
      "inner",
    );

    const secondExtract = await extractArchive(zipPath, new Set([workspace]));
    assert.ok(secondExtract.ok);
    assert.ok(secondExtract.ok && secondExtract.extractedTo.endsWith("项目文件夹-2"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("extract and compress refuse to overwrite and stay inside the roots", { skip: !hasBsdtar }, async () => {
  const { compressToZip, extractArchive } = await loadSubject();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-archive-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-archive-out-"));
  try {
    const file = path.join(workspace, "doc.txt");
    fs.writeFileSync(file, "x");

    const firstZip = await compressToZip(file, new Set([workspace]));
    assert.ok(firstZip.ok);
    const conflict = await compressToZip(file, new Set([workspace]));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.ok ? 0 : conflict.status, 409);

    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "x");
    const denied = await compressToZip(outsideFile, new Set([workspace]));
    assert.equal(denied.ok, false);
    assert.equal(denied.ok ? 0 : denied.status, 403);

    // Extraction of a non-archive file fails without leaving junk behind.
    const notArchive = await extractArchive(file, new Set([workspace]));
    assert.equal(notArchive.ok, false);
    assert.ok(!fs.existsSync(path.join(workspace, "doc_extracted")));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
