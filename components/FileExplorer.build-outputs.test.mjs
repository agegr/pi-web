import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Node >= 23 strips the erasable TypeScript annotations natively; the lib is
// pure (no React, no jsx), so no jiti transpile is needed for a parse +
// behavior test.
const preference = await import("../lib/build-outputs-preference.ts");

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const multiRootSource = await readFile(new URL("./MultiRootFileExplorer.tsx", import.meta.url), "utf8");

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.ok(end !== -1, `end marker not found after ${startMarker}: ${endMarker}`);
  return text.slice(start, end);
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
  };
}

test("fetchEntries appends showBuildOutputs only when the preference is on", () => {
  assert.match(
    source,
    /async function fetchEntries\(\s*dirPath: string,\s*opts\?: \{ showBuildOutputs\?: boolean \},\s*\): Promise<FileNode\[\]> \{/,
  );
  // On: the opt-in query parameter rides along; off: the URL is unchanged.
  assert.match(source, /opts\?\.showBuildOutputs \? "\?type=list&showBuildOutputs=1" : "\?type=list"/);
  // Both type=list call sites thread the per-cwd preference through:
  // the root-load effect...
  assert.match(source, /fetchEntries\(cwd, \{ showBuildOutputs \}\)/);
  // ...and lazy child expansion (TreeNode reads the live preference for its
  // workspace root at fetch time).
  assert.match(
    source,
    /fetchEntries\(node\.fullPath, \{\s*showBuildOutputs: getShowBuildOutputs\(cwd\),\s*\}\)/,
  );
});

test("toggling persists per workspace and refreshes the tree in place", () => {
  const toggleBlock = sliceBetween(
    source,
    "const handleToggleShowBuildOutputs = useCallback(",
    "}, [cwd, showBuildOutputs]);",
  );
  // The preference write is keyed by the workspace root (cwd), not global.
  assert.match(toggleBlock, /setShowBuildOutputs\(cwd, next\)/);
  // The shared refresh token bumps, so the root effect and every expanded
  // node re-fetch in place without a page reload.
  assert.match(toggleBlock, /setTreeRefreshKey\(\(key\) => key \+ 1\);/);
  // The root-load effect depends on the toggle state and the refresh token.
  const rootEffectBlock = sliceBetween(
    source,
    "fetchEntries(cwd, { showBuildOutputs })",
    "[cwd, refreshKey, treeRefreshKey, showBuildOutputs]);",
  );
  assert.match(rootEffectBlock, /\.then\(\(entries\) => \{ if \(!cancelled\) setRoots\(entries\); \}\)/);
});

test("co-mounted explorers of the same root follow the preference change event", () => {
  // FileExplorer subscribes to the preference broadcast and filters it by
  // its own workspace root before applying.
  const subscribeBlock = sliceBetween(
    source,
    "useEffect\(\(\) => {\n    return subscribeShowBuildOutputs\(",
    "}, \[cwd\]\);",
  );
  assert.match(subscribeBlock, /normalizeFilePathSlashes\(root\) !== normalizeFilePathSlashes\(cwd\)/);
  assert.match(subscribeBlock, /setTreeRefreshKey\(\(key\) => key \+ 1\);/);
});

test("the toggle renders default-off and hydrates from storage in an effect", () => {
  // Default off: initial state is false, the real value arrives in an
  // effect so SSR prerender and hydration agree.
  assert.match(source, /const \[showBuildOutputs, setShowBuildOutputsState\] = useState\(false\);/);
  assert.match(source, /setShowBuildOutputsState\(getShowBuildOutputs\(cwd\)\);/);
  // The checkbox is wired to the toggle handler.
  assert.match(source, /checked=\{showBuildOutputs\}/);
  assert.match(source, /onChange=\{handleToggleShowBuildOutputs\}/);
});

test("MultiRootFileExplorer mounts FileExplorer per root without overriding the toggle", () => {
  // One FileExplorer per root, driven by cwd={root.root}: each instance owns
  // its own per-root preference, so the container must not pass any
  // show-build-outputs prop of its own.
  assert.match(multiRootSource, /<FileExplorer/);
  assert.match(multiRootSource, /cwd=\{root\.root\}/);
  assert.ok(!multiRootSource.includes("showBuildOutputs"), "the container must not override the per-root toggle");
});

test("the preference is persisted per workspace root and defaults to off", () => {
  const storage = memoryStorage();
  const rootA = "/workspaces/alpha";
  const rootB = "/workspaces/beta";
  // Default: absent storage reads as off for every root.
  assert.equal(preference.getShowBuildOutputs(rootA, storage), false);
  assert.equal(preference.getShowBuildOutputs(rootB, storage), false);
  assert.equal(preference.getShowBuildOutputs(rootA, null), false);
  // Round trip: enabling A leaves B off (keyed by the root path).
  preference.setShowBuildOutputs(rootA, true, storage, null);
  assert.equal(preference.getShowBuildOutputs(rootA, storage), true);
  assert.equal(preference.getShowBuildOutputs(rootB, storage), false);
  // Keys are derived from the root, encoded, under the app's pi- prefix.
  assert.ok(storage.getItem("pi-web:file-explorer:show-build-outputs:%2Fworkspaces%2Falpha") === "1");
  // Corrupt values degrade to off, never throw.
  storage.setItem("pi-web:file-explorer:show-build-outputs:%2Fworkspaces%2Falpha", "maybe");
  assert.equal(preference.getShowBuildOutputs(rootA, storage), false);
});

test("the change event broadcast keeps co-mounted explorers in sync", () => {
  // A browser-like event target: in Node tests the global `window` is absent,
  // so the target is injected exactly the way the component injects nothing
  // in the browser (where window exists by default).
  const target = new EventTarget();
  const seen = [];
  const unsubscribe = preference.subscribeShowBuildOutputs((change) => seen.push(change), target);
  try {
    preference.setShowBuildOutputs("/workspaces/alpha", true, memoryStorage(), target);
    assert.deepEqual(seen, [{ root: "/workspaces/alpha", value: true }]);
  } finally {
    unsubscribe();
  }
  // After unsubscribe no further events arrive.
  preference.setShowBuildOutputs("/workspaces/alpha", false, memoryStorage(), target);
  assert.equal(seen.length, 1);
});
