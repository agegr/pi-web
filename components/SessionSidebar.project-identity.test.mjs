import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const customPathStart = source.indexOf("const commitCustomPath = useCallback");
const customPathEnd = source.indexOf("const handleCustomPathClick", customPathStart);
const customPathSource = source.slice(customPathStart, customPathEnd);

test("custom cwd selection installs validated identity before changing cwd", () => {
  assert.notEqual(customPathStart, -1);
  assert.notEqual(customPathEnd, -1);
  assert.match(customPathSource, /projectRoot\?: string;[\s\S]*?projectKey\?: string;/);

  const identityUpdate = customPathSource.indexOf("setValidatedProject(");
  const cwdUpdate = customPathSource.indexOf("setSelectedCwd(");
  assert.ok(identityUpdate >= 0, "validated project identity is retained");
  assert.ok(cwdUpdate > identityUpdate, "identity is retained before cwd changes");
});

test("custom cwd selection remembers the last validated path for the picker", () => {
  assert.match(customPathSource, /saveLastCustomCwd\(data\.cwd\)/);
  assert.match(source, /initialPath=\{customPathValue\}/);
});

test("default cwd is selected through the same validation as a custom path", () => {
  const defaultStart = source.indexOf("const handleDefaultCwd = useCallback");
  const defaultEnd = source.indexOf("const handleCreateWorktree", defaultStart);
  const defaultSource = source.slice(defaultStart, defaultEnd);
  assert.notEqual(defaultStart, -1);
  assert.match(defaultSource, /commitCustomPath\(data\.cwd, \{ remember: false \}\)/);
  assert.doesNotMatch(defaultSource, /setSelectedCwd\(/);
  assert.match(customPathSource, /if \(remember\) \{\s*saveLastCustomCwd\(data\.cwd\)/);
});
