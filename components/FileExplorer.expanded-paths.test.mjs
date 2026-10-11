import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const cwdEffect = source.slice(
  source.indexOf("    const previousCwd = prevCwdRef.current;"),
  source.indexOf("  }, [cwd, refreshKey, treeRefreshKey, showHidden]);"),
);

test("a cwd change keeps the folder left and restores the one entered (lib/file-tree-expansion.test.mjs runs the memory)", () => {
  assert.match(source, /^const expandedPathsByCwd = createExpandedPathsMemory\(\);$/m);
  assert.match(cwdEffect, /if \(cwdChanged\) \{\n\s*if \(previousCwd !== null\) expandedPathsByCwd\.save\(previousCwd, expandedPathsRef\.current\);\n\s*const restored = expandedPathsByCwd\.restore\(cwd\);\n\s*expandedPathsRef\.current = restored;\n\s*setExpandedPaths\(restored\);/);
  assert.doesNotMatch(source, /setExpandedPaths\(new Set\(\)\)/);
  // The rest of a folder's state still starts over.
  for (const reset of ["setHighlightedPaths(new Set())", "setUploadSummary(null)", "setPendingConflict(null)", "setUploadError(null)"]) {
    assert.ok(cwdEffect.includes(reset), reset);
  }
});

test("the set saved is the one last committed, also when the explorer unmounts", () => {
  const sync = source.indexOf("    expandedPathsRef.current = expandedPaths;\n  }, [expandedPaths]);");
  assert.ok(sync > 0 && sync < source.indexOf("    const previousCwd = prevCwdRef.current;"), "the ref follows the state before the cwd effect reads it");
  assert.match(source, /useEffect\(\(\) => \(\) => \{\n\s*if \(prevCwdRef\.current !== null\) expandedPathsByCwd\.save\(prevCwdRef\.current, expandedPathsRef\.current\);\n\s*\}, \[\]\);/);
});

test("restored directories list themselves: the roots remount, and an open unlisted directory loads on mount", () => {
  // Loading hides the old roots, so the new cwd's directories mount with the restored set.
  assert.match(cwdEffect, /setLoading\(cwdChanged\);/);
  assert.match(source, /\{loading \? \(\n\s*<div[^>]*>Loading files\.\.\.<\/div>/);
  assert.match(source, /useEffect\(\(\) => \{\n\s*if \(node\.isDir && open && !loaded && !pendingLinkTarget\) loadChildren\(\);/);
  // A directory gone since is never listed, so its path is never looked up; one that fails to list says so in place.
  assert.match(source, /const open = expandedPaths\.has\(node\.fullPath\);/);
  assert.match(source, /\{node\.isDir && open && !pendingLinkTarget && \(/);
});
