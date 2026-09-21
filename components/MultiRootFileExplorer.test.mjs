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
