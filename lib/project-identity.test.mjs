import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./project-identity.ts");
}

test("Windows project identity ignores full-path casing and separator style", async () => {
  const { projectIdentityKey } = await loadSubject();

  const expected = projectIdentityKey("C:\\Users\\Alex\\Project\\Study\\ELM", "win32");
  assert.equal(projectIdentityKey("c:/users/ALEX/project/study/elm", "win32"), expected);
  assert.equal(projectIdentityKey("c:\\Users\\Alex\\Project\\Study\\.\\ELM\\", "win32"), expected);
});

test("Windows project identity handles UNC casing and separators", async () => {
  const { projectIdentityKey } = await loadSubject();

  assert.equal(
    projectIdentityKey("\\\\Server\\Share\\Team\\Agent", "win32"),
    projectIdentityKey("//server/share/team/AGENT/", "win32"),
  );
});

test("project identity preserves case on case-sensitive platforms", async () => {
  const { projectIdentityKey } = await loadSubject();

  assert.notEqual(
    projectIdentityKey("/Users/Alex/Project", "linux"),
    projectIdentityKey("/users/alex/project", "linux"),
  );
  assert.notEqual(
    projectIdentityKey("/a\\b", "linux"),
    projectIdentityKey("/a/b", "linux"),
  );
});
