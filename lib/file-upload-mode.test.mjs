import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { replaceUploadFile } = await createJiti(import.meta.url).import("./file-upload.ts");

test("overwriting an upload preserves existing permissions despite the process umask", { skip: process.platform === "win32" }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-upload-mode-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "script.sh");
  writeFileSync(file, "echo old\n");
  chmodSync(file, 0o755);
  const previousMask = process.umask(0o077);
  try {
    await replaceUploadFile(file, Buffer.from("echo updated\n"));
  } finally {
    process.umask(previousMask);
  }
  assert.equal(readFileSync(file, "utf8"), "echo updated\n");
  assert.equal(statSync(file).mode & 0o777, 0o755);
});
