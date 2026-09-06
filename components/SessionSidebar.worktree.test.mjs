import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("session refreshes do not invalidate worktrees", () => {
  const loadStart = source.indexOf("// Load worktrees for the current effective cwd");
  const loadEnd = source.indexOf("// Auto-select cwd", loadStart);
  const loadBlock = source.slice(loadStart, loadEnd);
  assert.match(loadBlock, /\}, \[selectedCwd, wtRefreshKey\]\);/);
  assert.doesNotMatch(loadBlock, /\[[^\]]*refreshKey/);
  assert.match(loadBlock, /signal: controller\.signal/);
  assert.match(loadBlock, /controller\.abort\(\)/);
  assert.match(loadBlock, /if \(force\) worktreeParams\.set\("force", "1"\)/);
  assert.match(source, /setWtRefreshKey\(\(key\) => key \+ 1\);[\s\S]*?onExplorerRefresh/);
  assert.match(source, /setExplorerForceKey\(\(key\) => key \+ 1\)/);
  assert.match(source, /suppressNextExternalExplorerRefreshRef\.current = true/);
});

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(source, /if \(currentWorktreePath === path\) setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});
