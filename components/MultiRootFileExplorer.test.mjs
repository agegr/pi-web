import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./MultiRootFileExplorer.tsx");

const source = await readFile(new URL("./MultiRootFileExplorer.tsx", import.meta.url), "utf8");
const explorerSource = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("renders one FileExplorer per root, mounted only while its section is expanded", () => {
  assert.match(source, /roots\.map\(\(root\) => \{/);
  assert.match(source, /\{expanded && \(\s*<FileExplorer/);
});

test("stale roots render a greyed inert header with no FileExplorer underneath", () => {
  assert.match(source, /const stale = staleRoots\.has\(root\.root\);/);
  assert.match(source, /if \(stale\) \{/);
  assert.match(source, /t\("sidebar\.pinnedProjectMissing"\)/);
  // The stale branch is non-interactive: no toggle handler in it.
  const staleBranch = source.slice(source.indexOf("if (stale) {"), source.indexOf("return (", source.indexOf("if (stale) {")));
  assert.doesNotMatch(staleBranch, /onClick/);
});

test("sections default to collapsed and restore persisted expansion after mount", () => {
  assert.match(source, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/);
  assert.match(source, /setExpandedKeys\(readExplorerSectionExpanded\(\)\);/);
  // Toggling persists the full new state.
  assert.match(
    source,
    /const handleToggleSection = useCallback\(\(key: string\) => \{[\s\S]*?writeExplorerSectionExpanded\(next\);/,
  );
});

test("refreshKey propagates to every mounted section's FileExplorer", () => {
  assert.match(source, /refreshKey=\{refreshKey\}/);
  assert.match(source, /refreshKey\?: number;/);
});

test("the aggregated changes badge sums across mounted sections and upload busy ORs", () => {
  assert.match(source, /onChangesCountChange\?: \(count: number\) => void;/);
  assert.match(source, /const changesByKey = useRef\(new Map<string, number>\(\)\);/);
  assert.match(
    source,
    /const handleSectionChanges = useCallback\(\(key: string\) => \(count: number\) => \{[\s\S]*?changesByKey\.current\.set\(key, count\);[\s\S]*?notifyChanges\(\);/,
  );
  assert.match(
    source,
    /const notifyChanges = useCallback\(\(\) => \{[\s\S]*?onChangesCountChangeRef\.current\?\.\(sum\);/,
  );
  assert.match(source, /busy = busy \|\| value;/);
  // Aggregate entries for removed roots are pruned so the badge never counts
  // an unpinned section.
  assert.match(source, /changesByKey\.current\.delete\(key\);/);
});

test("the imperative upload handle targets the first expanded section, else the first root", () => {
  assert.match(
    source,
    /roots\.find\(\(root\) => expandedKeys\.has\(root\.key\) && !staleRoots\.has\(root\.root\)\)/,
  );
  assert.match(source, /\?\? roots\.find\(\(root\) => !staleRoots\.has\(root\.root\)\)/);
  // Review-FAIL blocker 1 fix: upload expands + persists the target section
  // before delegating, and waits for the section's handle to mount.
  assert.match(source, /setPendingPickerKey\(key\);/);
  assert.match(
    source,
    /const handle = sectionHandles\.current\.get\(pendingPickerKey\);[\s\S]*?handle\.openUploadPicker\(\);/,
  );
  assert.match(
    source,
    /openUploadPicker\(\) \{[\s\S]*?writeExplorerSectionExpanded\(next\);[\s\S]*?setPendingPickerKey\(key\);/,
  );
});

test("file search opens in the deterministic target section only", () => {
  assert.match(source, /fileSearchOpen=\{fileSearchOpen && targetRoot\?\.key === root\.key\}/);
  assert.match(source, /onFileSearchOpenChange=\{onFileSearchOpenChange\}/);
});

test("an empty root set renders an inert hint line and no sections", () => {
  assert.match(source, /if \(roots\.length === 0\) \{/);
  assert.match(source, /t\("sidebar\.explorerEmpty"\)/);
});

test("FileExplorer itself stays untouched: every capability is an existing prop", () => {
  // The container relies only on props FileExplorer already supports.
  for (const prop of [
    "cwd",
    "refreshKey",
    "onOpenFile",
    "onAtMention",
    "onAtMentions",
    "onUploadBusyChange",
    "changesCollapsed",
    "onChangesCountChange",
    "fileSearchOpen",
    "onFileSearchOpenChange",
  ]) {
    assert.match(explorerSource, new RegExp(`${prop}[?]?:`));
  }
  assert.match(explorerSource, /openUploadPicker\(\)/);
});

test("section headers carry stable locator attributes for e2e", () => {
  assert.match(source, /data-explorer-section=\{root\.root\}/);
  assert.match(source, /aria-expanded=\{expanded\}/);
});

test("exactly one global build-outputs toggle renders at the bottom of the block", () => {
  // One checkbox for the whole block, rendered once — never per root.
  const checkboxCount = (source.match(/checked=\{showBuildOutputs\}/g) ?? []).length;
  assert.equal(checkboxCount, 1, "exactly one build-outputs checkbox in the container");
  // It reuses the existing i18n keys — no new keys, no copy changes.
  assert.match(source, /t\("files\.showBuildOutputsHint"\)/);
  assert.match(source, /\{t\("files\.showBuildOutputs"\)\}/);
  // Toggling writes the global preference so the broadcast drives every
  // mounted FileExplorer's in-place re-fetch.
  assert.match(source, /setShowBuildOutputs\(next\);/);
  // Hydration + subscription keep the single checkbox in step.
  assert.match(source, /setShowBuildOutputsState\(getShowBuildOutputs\(\)\);/);
  assert.match(source, /return subscribeShowBuildOutputs\(\(\{ value \}\) => \{/);
  // Position: the label must come AFTER the roots.map sections in source
  // order, so it renders below every root tree.
  const mapClose = source.indexOf("        })}\n");
  const labelPos = source.indexOf("checked={showBuildOutputs}");
  assert.ok(mapClose !== -1 && labelPos > mapClose, "the toggle must render after the last root section");
});

test("TreeNode indents the row box itself by depth", () => {
  // The indent must shift the ROW BOX (its left edge and hover-highlight
  // strip), not merely pad content inside a full-width row: per-level
  // marginLeft on the row element.
  assert.match(explorerSource, /marginLeft: depth \* 14,/);
  // Base content padding is kept so rows do not hug the container edge.
  assert.match(explorerSource, /paddingLeft: 8,/);
  // Children render one level deeper, so each nesting level shifts right
  // by a further 14px (>= 12px per level).
  assert.match(explorerSource, /depth=\{depth \+ 1\}/);
  // The "empty" placeholder row follows the same geometry.
  assert.match(explorerSource, /marginLeft: \(depth \+ 1\) \* 14, paddingLeft: 8/);
  // The old content-only indent must be gone: padding inside a full-width
  // row left the row box flush with its parent (the observed defect).
  assert.ok(!explorerSource.includes("paddingLeft: 8 + depth * 14"), "no content-only indent may remain");
});
