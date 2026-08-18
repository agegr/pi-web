import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./extension-links.ts");
  } catch {
    return import("./extension-links.ts");
  }
}

const { findDirectExtensionSymlink, unlinkExtensionSymlink } = await loadSubject();

test("finds and unlinks only the direct extension symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-extension-links-"));
  const extensions = join(root, "extensions");
  const source = join(root, "source");
  await mkdir(extensions);
  await mkdir(source);
  await writeFile(join(source, "index.ts"), "export default () => {}\n");
  await symlink(source, join(extensions, "robin"));

  const link = findDirectExtensionSymlink(join(extensions, "robin", "index.ts"), extensions);
  assert.equal(link, join(extensions, "robin"));
  unlinkExtensionSymlink(link);
  assert.equal(await readFile(join(source, "index.ts"), "utf8"), "export default () => {}\n");
});

test("refuses regular entries and resources outside the extension root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-extension-links-"));
  const extensions = join(root, "extensions");
  const regular = join(extensions, "regular.ts");
  await mkdir(extensions);
  await writeFile(regular, "keep\n");

  assert.equal(findDirectExtensionSymlink(regular, extensions), undefined);
  assert.equal(findDirectExtensionSymlink(join(root, "outside.ts"), extensions), undefined);
  assert.throws(() => unlinkExtensionSymlink(regular), /not a symbolic link/);
  assert.equal(await readFile(regular, "utf8"), "keep\n");
});
