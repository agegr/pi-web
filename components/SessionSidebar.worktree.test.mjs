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
  assert.match(source, /if \(currentWorktreePath === path\) \{[\s\S]*?setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("quick worktree buttons drive cwd selection and client-side session filtering", () => {
  assert.match(source, /worktreeState\.worktrees\.map\(\(wt, index\) =>/);
  assert.match(source, /setShowAllWorktreeSessions\(false\);\s+setSelectedCwd\(wt\.path\)/);
  assert.match(
    source,
    /showWorktreeSwitcher\s+&& !showAllWorktreeSessions\s+&& currentWorktreePath\s+\? sessionsForWorktree\(projectSessions, currentWorktreePath\)/,
  );
  assert.match(source, /setShowAllWorktreeSessions\(true\)/);
  assert.match(source, /hasRunning \? t\("sidebar\.agentRunning"\) : null/);
  assert.match(source, /hasUnread \? t\("sidebar\.newSessionActivity"\) : null/);
  assert.match(source, /aria-label=\{`\$\{index \+ 1\}: \$\{label\}\$\{activityLabel/);
  assert.match(source, /hasRunning \? "var\(--accent\)" : "#0891b2"/);
});
