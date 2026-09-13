import assert from "node:assert/strict";
import test from "node:test";

import { getRelativeFilePath, sameFilePath } from "./file-paths.ts";

test("keeps absolute Windows paths when cwd casing differs", () => {
  const filePath = "D:/Work/repo/docs/guide.md";
  const relative = getRelativeFilePath(filePath, "d:/work/repo");

  // A selection is reopened from its canonical absolute path; it must not be
  // turned into a second absolute path under a case-variant cwd.
  assert.equal(relative, filePath);
  assert.equal(sameFilePath(filePath, "d:/work/repo/docs/guide.md"), true);
});

test("compares Windows paths by filesystem identity", () => {
  assert.equal(sameFilePath("D:\\Work\\repo\\docs\\..\\guide.md", "d:/work/repo/guide.md"), true);
  assert.equal(sameFilePath("D:/work/repo/guide.md", "D:/other/guide.md"), false);
  assert.equal(sameFilePath("/work/repo/guide.md", "/Work/repo/guide.md"), false);
});
