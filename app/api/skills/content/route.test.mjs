import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-skill-content-"));
const agentDir = join(root, "agent");
const skillsDir = join(agentDir, "skills");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const skillDir = join(skillsDir, "preview");
const skillPath = join(skillDir, "SKILL.md");
const skillContent = "---\nname: preview\ndescription: Preview skill\n---\n\n# Preview\n\n- formatted\n";
await mkdir(join(skillDir, "references", "nested"), { recursive: true });
await writeFile(skillPath, skillContent);
const documents = {
  "references/nested/guide.md": "---\ntitle: Reference\n---\n# Nested reference\n",
  "references/other.markdown": "# Other\n",
  "references/UPPER.MD": "# Upper\n",
  "references/a space + ü.md": "# Filename\n",
  "references/hash#name.md": "# Literal hash\n",
  "references/literal%20name.md": "# Not a space\n",
  "%2e%2e%2foutside.md": "# Literal encoded-looking name\n",
  "references/%2F%5C%00.md": "# Not separators or a control character\n",
};
// Windows filenames cannot contain a literal question mark.
if (process.platform !== "win32") documents["references/query?.md"] = "# Literal question mark\n";
for (const [name, content] of Object.entries(documents)) {
  await writeFile(join(skillDir, name), content);
}
await writeFile(join(skillDir, "unsupported.txt"), "not Markdown");
await symlink(join(skillDir, "unsupported.txt"), join(skillDir, "text.md"));
await mkdir(join(skillDir, "directory.md"));
await writeFile(join(skillDir, "limit.md"), "x".repeat(1024 * 1024));
await writeFile(join(skillDir, "large.md"), "x".repeat(1024 * 1024 + 1));
const outsideDir = join(root, "outside");
await mkdir(outsideDir);
await writeFile(join(outsideDir, "secret.md"), "PRIVATE CONTENT");
// Prefix sibling is not contained in the root either.
await mkdir(`${skillDir}-sibling`);
await writeFile(join(`${skillDir}-sibling`, "secret.md"), "PRIVATE CONTENT");
await symlink(join(outsideDir, "secret.md"), join(skillDir, "escape.md"));
await symlink(outsideDir, join(skillDir, "escape-dir"));
await symlink(`${skillDir}-sibling`, join(skillDir, "prefix-dir"));
await symlink(join(skillDir, "references"), join(skillDir, "inside-dir"));
await symlink(join(skillDir, "references", "other.markdown"), join(skillDir, "inside.md"));
await symlink(join(root, "missing.md"), join(skillDir, "dangling.md"));
await symlink("loop.md", join(skillDir, "loop.md"));
if (process.platform !== "win32") execFileSync("mkfifo", [join(skillDir, "pipe.md")]);
await writeFile(join(skillDir, "unreadable.md"), "PRIVATE CONTENT");
await chmod(join(skillDir, "unreadable.md"), 0);

const linkedDir = join(root, "linked-target");
const linkedSkillPath = join(skillsDir, "linked", "SKILL.md");
await mkdir(linkedDir);
await writeFile(join(linkedDir, "SKILL.md"), "---\nname: linked\ndescription: Linked skill\n---\n# Linked\n");
await writeFile(join(linkedDir, "reference.md"), "# Linked reference\n");
await symlink(join(outsideDir, "secret.md"), join(linkedDir, "escape.md"));
await symlink(linkedDir, join(skillsDir, "linked"));

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed } = await jiti.import("../../../../lib/file-access.ts");
allowFileRoot(process.cwd());
const { GET } = await jiti.import("./route.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function contentUrl(filePath = skillPath, { cwd = process.cwd(), document } = {}) {
  const url = new URL("http://localhost/api/skills/content");
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("filePath", filePath);
  if (document !== undefined) url.searchParams.set("document", document);
  return url;
}

function getContent(filePath = skillPath, options) {
  return GET(new Request(contentUrl(filePath, options)));
}

async function assertError(response, status) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
  assert.ok(!body.error.includes(root), "must not expose filesystem paths");
  assert.ok(!body.error.includes("PRIVATE CONTENT"));
}

test("omission returns the original loaded file including frontmatter", async () => {
  const response = await getContent();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: skillContent });
});

test("reads nested Markdown documents and treats filename characters literally", async () => {
  for (const [document, content] of Object.entries({ ...documents, "SKILL.md": skillContent })) {
    const response = await getContent(skillPath, { document });
    assert.equal(response.status, 200, document);
    assert.deepEqual(await response.json(), { content });
  }
  const normalized = await getContent(skillPath, { document: "./references//nested/./guide.md" });
  assert.equal(normalized.status, 200);
  assert.deepEqual(await normalized.json(), { content: documents["references/nested/guide.md"] });
});

test("URLSearchParams decodes transport once, never recursively", async () => {
  const base = contentUrl().toString();
  const decoded = await GET(new Request(`${base}&document=references%2Fnested%2Fguide.md`));
  assert.equal(decoded.status, 200);
  assert.deepEqual(await decoded.json(), { content: documents["references/nested/guide.md"] });
  for (const encoded of ["%2e%2e%2foutside.md", "%2Fetc%2Fsecret.md", "references%5Cother.md", "%00.md"]) {
    await assertError(await GET(new Request(`${base}&document=${encoded}`)), 400);
  }
  // Double encoding names an actual literal %2e%2e%2f filename, not traversal.
  const literal = await GET(new Request(`${base}&document=%252e%252e%252foutside.md`));
  assert.equal(literal.status, 200);
  assert.deepEqual(await literal.json(), { content: documents["%2e%2e%2foutside.md"] });
});

test("rejects parent, absolute, Windows, URL, backslash and NUL paths", async () => {
  for (const document of [
    "../outside.md", "references/../../outside.md", "references/../SKILL.md",
    "escape-dir/../SKILL.md", "/etc/secret.md", "//host/share/file.md",
    "C:/secret.md", "C:secret.md", "C:\\secret.md", "\\\\host\\share\\file.md",
    "references\\other.md", "https://example.com/file.md", "file:secret.md",
    "data:text/plain,file.md", "references/stream:secret.md", "bad\0.md",
  ]) {
    await assertError(await getContent(skillPath, { document }), 400);
  }
});

test("rejects unsupported extensions, missing documents, directories and oversized files", async () => {
  for (const document of ["", "unsupported.txt", "SKILL", "references", "SKILL.md.html", "SKILL.md#heading", "text.md"]) {
    await assertError(await getContent(skillPath, { document }), 415);
  }
  for (const document of ["missing.md", "missing/file.md", "unsupported.txt/child.md", "dangling.md", "loop.md"]) {
    await assertError(await getContent(skillPath, { document }), 404);
  }
  await assertError(await getContent(skillPath, { document: "directory.md" }), 400);
  await assertError(await getContent(skillPath, { document: "large.md" }), 413);
  const boundary = await getContent(skillPath, { document: "limit.md" });
  assert.equal(boundary.status, 200);
  assert.equal((await boundary.json()).content.length, 1024 * 1024);
  if (process.platform !== "win32") {
    await assertError(await getContent(skillPath, { document: "pipe.md" }), 400);
  }
  // Root reads any file anyway; elsewhere the read fails with an error naming the path.
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    await assertError(await getContent(skillPath, { document: "unreadable.md" }), 500);
  }
});

test("permits contained symlinks but refuses file, directory and prefix-sibling escapes", async () => {
  for (const document of ["inside.md", "inside-dir/other.markdown"]) {
    const response = await getContent(skillPath, { document });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { content: documents["references/other.markdown"] });
  }
  for (const document of ["escape.md", "escape-dir/secret.md", "prefix-dir/secret.md"]) {
    await assertError(await getContent(skillPath, { document }), 403);
  }
});

test("permits a symlink skill root without granting broader file access", async () => {
  const response = await getContent(linkedSkillPath, { document: "reference.md" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: "# Linked reference\n" });
  await assertError(await getContent(linkedSkillPath, { document: "escape.md" }), 403);
  assert.equal(isExistingFilePathAllowed(linkedDir, await getAllowedFileRoots()), false);
});

test("filePath must identify an exact runtime-loaded skill, even with document", async () => {
  for (const filePath of [join(outsideDir, "secret.md"), join(skillDir, "references", "other.markdown"), `${skillDir}/./SKILL.md`]) {
    for (const document of [undefined, "SKILL.md"]) {
      const response = await getContent(filePath, { document });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Skill not found" });
    }
  }
});

test("requires cwd and filePath and retains cwd authorization", async () => {
  const withoutCwd = await GET(new Request(`http://localhost/api/skills/content?filePath=${encodeURIComponent(skillPath)}`));
  const withoutFile = await GET(new Request(`http://localhost/api/skills/content?cwd=${encodeURIComponent(process.cwd())}&document=SKILL.md`));
  await assertError(withoutCwd, 400);
  await assertError(withoutFile, 400);
  await assertError(await getContent(skillPath, { cwd: outsideDir, document: "SKILL.md" }), 403);
});
