import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readSkillDocument, SkillDocumentError } = await jiti.import("./skill-document.ts");

test("omitted document preserves the original file and maps read failures to safe typed errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-document-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = { baseDir: root, filePath: join(root, "SKILL.md") };
  const fails = (status, message, document = null) => assert.throws(() => readSkillDocument(skill, document), (error) => {
    assert.ok(error instanceof SkillDocumentError);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.ok(!error.message.includes(root));
    return true;
  });

  fails(404, "Skill file not found");
  fails(404, "Skill document not found.", "SKILL.md");
  await writeFile(skill.filePath, "");
  assert.equal(readSkillDocument(skill), "");
  assert.equal(readSkillDocument(skill, "SKILL.md"), "");
  const content = "\uFEFF---\r\nname: original\r\n---\r\n# Instructions\r\n";
  await writeFile(skill.filePath, content);
  assert.equal(readSkillDocument(skill), content);
  assert.equal(readSkillDocument(skill, "SKILL.md"), content);
  // Byte cap, not character count, on the default read as well.
  await writeFile(skill.filePath, "é".repeat(512 * 1024));
  assert.equal(readSkillDocument(skill).length, 512 * 1024);
  await writeFile(skill.filePath, "é".repeat(512 * 1024 + 1));
  fails(413, "Skill document exceeds the 1 MiB limit.");
  fails(413, "Skill document exceeds the 1 MiB limit.", "SKILL.md");
  await rm(skill.filePath);
  await mkdir(skill.filePath);
  fails(400, "Skill document is not a regular file.");
  fails(400, "Skill document is not a regular file.", "SKILL.md");
});

test("a Markdown-named symlink cannot reveal a non-Markdown file in the skill folder", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-document-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "config.txt"), "Not Markdown");
  await symlink(join(root, "config.txt"), join(root, "reference.md"));
  assert.throws(() => readSkillDocument({ baseDir: root, filePath: join(root, "SKILL.md") }, "reference.md"), (error) => {
    assert.ok(error instanceof SkillDocumentError);
    assert.equal(error.status, 415);
    return true;
  });
});

test("default is the loader's exact file, not an assumed baseDir/SKILL.md", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-document-default-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseDir = join(root, "skill");
  await mkdir(baseDir);
  const original = join(root, "original.md");
  await writeFile(original, "# Runtime-selected instructions\n");
  const filePath = join(baseDir, "SKILL.md");
  await symlink(original, filePath);
  const skill = { baseDir, filePath };
  assert.equal(readSkillDocument(skill), "# Runtime-selected instructions\n");
  // An explicit document never inherits that exact-entry exception.
  assert.throws(() => readSkillDocument(skill, "SKILL.md"), (error) => {
    assert.ok(error instanceof SkillDocumentError);
    assert.equal(error.status, 403);
    return true;
  });
});
