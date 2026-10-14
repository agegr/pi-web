import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { PROJECT_SETTINGS_MAX_BYTES, readRegularFileText, RegularFileError } = await jiti.import("./regular-file.ts");

function regularFileError(reason, message) {
  return (error) => {
    assert.ok(error instanceof RegularFileError);
    assert.equal(error.reason, reason);
    assert.equal(error.message, message);
    return true;
  };
}

test("a regular file is read whole, a missing one is undefined, and anything else throws without blocking", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-regular-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "settings.json");

  assert.equal(readRegularFileText(path), undefined);
  assert.equal(readRegularFileText(path, 8), undefined);
  // A missing folder above it, or a file where a folder should be, is missing too, as existsSync() says.
  assert.equal(readRegularFileText(join(dir, "nope", "settings.json")), undefined);
  await writeFile(join(dir, "file"), "x");
  assert.equal(readRegularFileText(join(dir, "file", "settings.json")), undefined);

  // The text as written, byte-order mark included: the caller parses it as pi does.
  await writeFile(path, "﻿{\"a\":\"é\"}");
  assert.equal(readRegularFileText(path), "﻿{\"a\":\"é\"}");
  assert.equal(readRegularFileText(path, 64), "﻿{\"a\":\"é\"}");

  // A link is followed, as pi follows it; a dangling one reads as missing.
  const link = join(dir, "link.json");
  await symlink(path, link);
  assert.equal(readRegularFileText(link), "﻿{\"a\":\"é\"}");
  const dangling = join(dir, "dangling.json");
  await symlink(join(dir, "gone.json"), dangling);
  assert.equal(readRegularFileText(dangling), undefined);

  // The cap counts bytes, not characters.
  await writeFile(path, "é".repeat(4));
  assert.equal(readRegularFileText(path, 8), "é".repeat(4));
  assert.throws(() => readRegularFileText(path, 7), regularFileError("too_large", `${path} is larger than 7 bytes`));
  await writeFile(path, "");
  assert.equal(readRegularFileText(path, 0), "");
  assert.equal(PROJECT_SETTINGS_MAX_BYTES, 1024 * 1024);

  await rm(path);
  await mkdir(path);
  assert.throws(() => readRegularFileText(path), regularFileError("nonregular", `${path} is not a regular file`));
  if (process.platform !== "win32") {
    await rm(path, { recursive: true });
    execFileSync("mkfifo", [path]);
    assert.throws(() => readRegularFileText(path), regularFileError("nonregular", `${path} is not a regular file`));
    assert.throws(() => readRegularFileText("/dev/zero", 16), regularFileError("nonregular", "/dev/zero is not a regular file"));
  }
});
