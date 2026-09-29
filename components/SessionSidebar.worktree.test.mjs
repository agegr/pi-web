import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(source, /if \(currentWorktreePath === path\) setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("lists local branches for quick switching next to the worktrees", () => {
  // The API carries the branch list, and a branch that already has a checkout
  // selects that worktree instead of creating one.
  assert.match(source, /branches: string\[\]/);
  assert.match(source, /branches: d\.branches \?\? \[\]/);
  assert.match(source, /t\("sidebar\.localBranches"\)/);
  assert.match(
    source,
    /const worktreeForBranch = worktreeState\.worktrees\.find\(\(w\) => w\.branch === branch\)/,
  );
  assert.match(
    source,
    /worktreeForBranch\n\s+\? \(setSelectedCwd\(worktreeForBranch\.path\), setWtDropdownOpen\(false\), setWtError\(null\), setWtFilter\(""\)\)\n\s+: void handleUseBranch\(branch\)/,
  );
  // The branch list honors the worktree filter, and creation is one shared flow.
  assert.match(
    source,
    /const visibleBranches = showWtFilter && wtFilter\.trim\(\)[\s\S]*?worktreeState\.branches\.filter/,
  );
  // The filter appears once the two sections together get long, and both
  // sections are gated on it so an unmounting input cannot leave the branch
  // list filtered by an invisible value.
  assert.match(
    source,
    /const showWtFilter = worktreeState\.worktrees\.length \+ worktreeState\.branches\.length >= 8/,
  );
  assert.match(source, /const handleCreateWorktree = useCallback\(\s*\(\) => handleUseBranch\(wtNewBranch\)/);
});

test("deletes an unheld local branch from the dropdown behind a confirm row", () => {
  // The row became the worktree-row shape: a select/create button plus a
  // bin button that only appears for branches no worktree holds.
  assert.match(
    source,
    /className="wt-row"[\s\S]*?\{!worktreeForBranch && !wtBusy && \(/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => \{ setWtConfirmDeleteBranch\(branch\); setWtDeleteUnmerged\(false\); \}\}\n\s+title=\{t\("sidebar\.deleteBranchTitle", \{ branch \}\)\}/,
  );
  // Confirm row mirrors the worktree force-remove row; the first pass asks
  // before deleting, the second (unmerged) pass is the force retry.
  assert.match(source, /const \[wtConfirmDeleteBranch, setWtConfirmDeleteBranch\] = useState<string \| null>\(null\)/);
  assert.match(
    source,
    /if \(wtConfirmDeleteBranch === branch\) \{[\s\S]*?wtDeleteUnmerged \? t\("sidebar\.confirmForceDeleteBranch"\) : t\("sidebar\.confirmDeleteBranch"\)[\s\S]*?onClick=\{\(\) => void handleDeleteBranch\(branch, wtDeleteUnmerged\)\}/,
  );
  // API call: shared wtBusy gate, unmerged 409 arms the force retry, success
  // refreshes the list without closing the dropdown.
  assert.match(
    source,
    /const handleDeleteBranch = useCallback\(async \(branch: string, force: boolean\) => \{[\s\S]*?if \(!worktreeState \|\| wtBusy\) return;[\s\S]*?fetch\("\/api\/branches", \{[\s\S]*?method: "DELETE"[\s\S]*?branch, force \}\),/,
  );
  assert.match(
    source,
    /if \(data\.unmerged && !force\) \{[\s\S]*?setWtConfirmDeleteBranch\(branch\);[\s\S]*?setWtDeleteUnmerged\(true\);[\s\S]*?setWtRefreshKey\(\(k\) => k \+ 1\);/,
  );
  assert.doesNotMatch(source, /handleDeleteBranch[\s\S]{0,600}?setWtDropdownOpen\(false\)/);
  // Success keeps the dropdown open, matching worktree removal.
  const deleteBody = source.match(
    /const handleDeleteBranch = useCallback\([\s\S]*?\n  \}, \[worktreeState, wtBusy\]\);/,
  )?.[0] ?? "";
  assert.ok(deleteBody.includes("setWtRefreshKey((k) => k + 1)"));
  assert.ok(!deleteBody.includes("setWtDropdownOpen"));
});
