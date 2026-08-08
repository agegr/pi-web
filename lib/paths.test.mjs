import assert from "node:assert/strict";
import test from "node:test";

const isWindows = process.platform === "win32";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./paths.ts");
}

test("toNativePath converts git's POSIX output to native separators", async () => {
  const { toNativePath } = await loadSubject();
  if (isWindows) {
    // The regression this guards: `git rev-parse --path-format=absolute` prints
    // `D:/repo` on Windows, which never string-compares equal to a session cwd.
    assert.equal(toNativePath("D:/repo/sub"), "D:\\repo\\sub");
    assert.equal(toNativePath("D:\\repo\\sub"), "D:\\repo\\sub");
  } else {
    assert.equal(toNativePath("/repo/sub"), "/repo/sub");
  }
  assert.equal(toNativePath(""), "");
});

test("samePath ignores separator style and Windows case", async () => {
  const { samePath } = await loadSubject();
  assert.equal(samePath("/a/b", "/a/b"), true);
  assert.equal(samePath("/a/b/", "/a/b"), true, "trailing separators must not matter");
  assert.equal(samePath("/a/./b", "/a/b"), true, "dot segments must not matter");
  assert.equal(samePath("/a/b", "/a/c"), false);
  assert.equal(samePath("", ""), true);
  assert.equal(samePath("", "/a"), false);

  if (isWindows) {
    assert.equal(samePath("D:/repo", "D:\\repo"), true, "separator style must not matter");
    assert.equal(samePath("d:\\repo", "D:\\repo"), true, "drive-letter case must not matter");
    assert.equal(samePath("D:\\Repo\\Sub", "d:/repo/sub"), true);
    assert.equal(samePath("D:\\repo\\", "D:/repo"), true);
    assert.equal(samePath("D:\\repo", "D:\\repo2"), false);
  } else {
    // POSIX is case-sensitive and backslash is a legal filename character.
    assert.equal(samePath("/Repo", "/repo"), false);
    assert.equal(samePath("/a\\b", "/a/b"), false);
  }
});

test("toSlashPath normalizes to forward slashes", async () => {
  const { toSlashPath } = await loadSubject();
  assert.equal(toSlashPath("D:\\repo\\sub"), "D:/repo/sub");
  assert.equal(toSlashPath("/repo/sub"), "/repo/sub");
});

test("isWindowsAbsolutePath recognizes drive and UNC paths", async () => {
  const { isWindowsAbsolutePath } = await loadSubject();
  assert.equal(isWindowsAbsolutePath("D:\\repo"), true);
  assert.equal(isWindowsAbsolutePath("d:/repo"), true);
  assert.equal(isWindowsAbsolutePath("\\\\server\\share"), true);
  assert.equal(isWindowsAbsolutePath("relative/path"), false);
});
