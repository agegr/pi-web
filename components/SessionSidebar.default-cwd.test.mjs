import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

// wi pi#49 R2 removed the workspace dropdown entirely — and with it the
// default-directory shortcut that lived in the dropdown body. The default
// cwd is now covered by the entry logic only: the one-shot initial
// auto-select / URL restore picks the effective workspace on load.
test("the default-directory shortcut and its visibility rule are gone with the dropdown", () => {
  assert.doesNotMatch(source, /shouldShowDefaultCwdShortcut|syntheticProjectFor/);
  assert.doesNotMatch(source, /default-cwd/);
  assert.doesNotMatch(source, /handleDefaultCwd|showDefaultCwdShortcut/);
  assert.doesNotMatch(source, /const \[defaultCwd, setDefaultCwd\]/);
});

test("the entry logic still selects an effective workspace on first load", () => {
  // URL restore: the restored session's cwd becomes the effective cwd.
  assert.match(
    source,
    /const target = allSessions\.find\(\(s\) => s\.id === initialSessionId\);[\s\S]*?setSelectedCwd\(target\.cwd\);/,
  );
  // Auto-select: the most recent project's root becomes the effective cwd.
  assert.match(
    source,
    /const projects = getRecentProjects\(allSessions\);[\s\S]*?setSelectedCwd\(projects\[0\]\.root\);/,
  );
});

test("arbitrary paths stay reachable through the Add-directory dialog", () => {
  // The standalone Add-directory button opens the picker (manage mode),
  // whose path input browses to any directory; the plain custom-path picker
  // (path input + browse, validated on commit) survives as its engine.
  assert.match(source, /addDirectoryOpen && \(\s*<DirectoryPicker/);
  assert.match(source, /onClick=\{\(\) => setAddDirectoryOpen\(true\)\}/);
  assert.match(source, /initialPath=\{customPathValue \|\| homeDir \|\| undefined\}/);
});
