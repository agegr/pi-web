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
  const defaultEnd = source.indexOf("const handleDefaultCwdRef", defaultStart);
  const defaultSource = source.slice(defaultStart, defaultEnd);
  assert.notEqual(defaultStart, -1);
  assert.match(defaultSource, /commitCustomPath\(data\.cwd, \{ remember: false, purpose \}\)/);
  // The files tab's by default; the composer's bar names its own purpose.
  assert.match(defaultSource, /const handleDefaultCwd = useCallback\(async \(purpose: "files" \| "new-session" = "files"\) => \{/);
  assert.doesNotMatch(defaultSource, /setSelectedCwd\(/);
  assert.match(customPathSource, /if \(remember\) \{\s*saveLastCustomCwd\(data\.cwd\)/);
});

test("the files tab is the picker's default purpose; the composer's bar opens it for itself", () => {
  assert.match(source, /useState<false \| "files" \| "new-session">\(false\)/);
  assert.match(source, /const handleCustomPathClick = useCallback\(\(\) => \{\s*setCustomPathOpen\("files"\);/);
  assert.doesNotMatch(source, /setCustomPathOpen\(true\)/);
  // Validation runs for both; only the files tab's pick moves the sidebar's cwd here.
  const newSession = customPathSource.indexOf('if (purpose === "new-session")');
  assert.ok(newSession >= 0 && newSession < customPathSource.indexOf("setValidatedProject("));
});
