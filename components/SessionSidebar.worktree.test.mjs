import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const messages = Object.fromEntries(await Promise.all(["en", "zh-CN", "zh-TW"].map(async (locale) => [
  locale,
  await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8"),
])));

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(source, /if \(currentWorktreePath === path\) setSelectedCwd\(project\.root\);/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("a folder outside git has no worktree box; a subdirectory of a checkout keeps the disabled one saying why", () => {
  // The hint is a git subdirectory's alone (the listing tells the two
  // apart: isGit); a non-git folder gets none, so the picker shows the
  // project box alone, in both layouts.
  assert.match(
    source,
    /const worktreeGuide = selectedCwd\s*&& worktreeState\?\.isGit\s*&& selectedProject\?\.key === worktreeState\.projectKey\s*&& !showWorktreeSwitcher\s*\? \{\s*label: t\("sidebar\.openRepoRoot"\),\s*title: t\("sidebar\.openRepoRootTitle"\),\s*\}\s*: null;/,
  );
  assert.doesNotMatch(source, /gitRepoRootOnly/);
  for (const locale of ["en", "zh-CN", "zh-TW"]) assert.doesNotMatch(messages[locale], /gitRepoRootOnly/, locale);
  // While a folder last found outside git is listed again, no "checking"
  // box shows only to go away and widen the project box: the browser keeps
  // those folders (sidebar-prefs), so a reload knows them before its
  // listing answers.
  assert.match(source, /const nonGitCwdsRef = useRef<Set<string> \| null>\(null\);\s*nonGitCwdsRef\.current \?\?= new Set\(loadNonGitCwds\(\)\);/);
  assert.match(source, /if \(d\.isGit\) nonGitCwdsRef\.current\?\.delete\(selectedCwd\);\s*else nonGitCwdsRef\.current\?\.add\(selectedCwd\);\s*rememberCwdGitStatus\(selectedCwd, Boolean\(d\.isGit\)\);/);
  assert.match(source, /const inactiveWorktreeSelector = worktreeGuide\s*\?\? \(worktreeLoading && !showWorktreeSwitcher && !\(selectedCwd && nonGitCwdsRef\.current\?\.has\(selectedCwd\)\)/);
});
