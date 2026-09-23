import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("worktree identity resolves through the listed directory entry, not a client-side current-worktree path", () => {
  // pi#45: the worktree switcher and its client-resolved currentWorktreePath
  // are gone. A worktree cwd is attributed to its listed directory via the
  // session's server-provided projectRoot (listedEntryForPath matches by
  // path containment, longest root wins).
  assert.match(source, /const entry = listedEntryForPath\(cwd\) \?\? listedEntryForPath\(projectRoot \?\? null\);/);
  assert.match(source, /expandPinnedGroup\(entry\.key\);/);
  // The removed machinery stays removed.
  assert.doesNotMatch(source, /currentWorktreePath: string \| null/);
  assert.doesNotMatch(source, /if \(currentWorktreePath === path\) setSelectedCwd/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});