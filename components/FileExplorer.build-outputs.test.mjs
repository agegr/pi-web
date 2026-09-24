import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Node >= 23 strips the erasable TypeScript annotations natively; the lib is
// pure (no React, no jsx), so no jiti transpile is needed for a parse +
// behavior test.
const preference = await import("../lib/build-outputs-preference.ts");
const { setShowBuildOutputs } = preference;

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const multiRootSource = await readFile(new URL("./MultiRootFileExplorer.tsx", import.meta.url), "utf8");

const GLOBAL_STORAGE_KEY = "pi-web:file-explorer:show-build-outputs";

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
  // Both type=list call sites thread the global preference through:
  // the root-load effect...
  assert.match(source, /fetchEntries\(cwd, \{ showBuildOutputs \}\)/);
  // ...and lazy child expansion (TreeNode reads the live global preference
  // at fetch time).
  assert.match(
    source,
    /fetchEntries\(node\.fullPath, \{\s*showBuildOutputs: getShowBuildOutputs\(\),\s*\}\)/,
  );
});

test("FileExplorer hydrates the global preference and refreshes on every broadcast", () => {
  // Default off: initial state is false, the real value arrives in an
  // effect so SSR prerender and hydration agree.
  assert.match(source, /const \[showBuildOutputs, setShowBuildOutputsState\] = useState\(false\);/);
  assert.match(source, /setShowBuildOutputsState\(getShowBuildOutputs\(\)\);/);
  // The subscription applies EVERY broadcast (the preference is one global
  // value — no root equality filter) and bumps the shared refresh token so
  // the root effect and every expanded node re-fetch in place.
  const subscribeBlock = sliceBetween(
    source,
    "return subscribeShowBuildOutputs(({ value }) => {",
    "}, []);",
  );
  assert.ok(subscribeBlock.includes("setShowBuildOutputsState(value);"), "broadcast must apply the new value");
  assert.ok(subscribeBlock.includes("setTreeRefreshKey((key) => key + 1);"), "broadcast must bump the refresh token");
  assert.ok(!subscribeBlock.includes("normalizeFilePathSlashes(root)"), "no root filter remains");
  // The root-load effect depends on the toggle state and the refresh token.
  const rootEffectBlock = sliceBetween(
    source,
    "fetchEntries(cwd, { showBuildOutputs })",
    "[cwd, refreshKey, treeRefreshKey, showBuildOutputs]);",
  );
  assert.match(rootEffectBlock, /\.then\(\(entries\) => \{ if \(!cancelled\) setRoots\(entries\); \}\)/);
});

test("no per-explorer build-outputs toggle remains in FileExplorer", () => {
  // The single toggle moved to MultiRootFileExplorer: FileExplorer only
  // consumes the preference.
  assert.ok(!source.includes("handleToggleShowBuildOutputs"), "toggle handler must be gone");
  assert.ok(!source.includes('checked={showBuildOutputs}'), "no checkbox may render inside FileExplorer");
  assert.ok(!source.includes("setShowBuildOutputs(cwd"), "no root-keyed setter call may remain");
  assert.ok(!source.includes('t("files.showBuildOutputs")'), "no build-outputs label may render inside FileExplorer");
});

test("MultiRootFileExplorer renders exactly one global toggle at the bottom of the block", () => {
  const checkboxCount = (multiRootSource.match(/checked=\{showBuildOutputs\}/g) ?? []).length;
  assert.equal(checkboxCount, 1, "exactly one build-outputs checkbox");
  assert.match(multiRootSource, /setShowBuildOutputs\(next\);/);
  // The label reuses the existing i18n keys, no new keys.
  assert.match(multiRootSource, /t\("files\.showBuildOutputsHint"\)/);
  assert.match(multiRootSource, /\{t\("files\.showBuildOutputs"\)\}/);
  // The single checkbox sits after the last root section: the roots.map
  // close comes before the label in source order.
  const mapEnd = multiRootSource.indexOf("})}\n        {/* Exactly one global");
  assert.ok(mapEnd !== -1, "the bottom toggle must come after the roots.map sections");
  // Hydration + subscription keep the checkbox in step with the global value.
  assert.match(multiRootSource, /setShowBuildOutputsState\(getShowBuildOutputs\(\)\);/);
  assert.match(multiRootSource, /return subscribeShowBuildOutputs\(\(\{ value \}\) => \{/);
});

test("the preference is one global value persisted under a single fixed key", async () => {
  const writtenKeys = [];
  const storage = {
    getItem: () => null,
    setItem: (key) => { writtenKeys.push(key); },
  };
  // Default: absent storage reads as off.
  assert.equal(preference.getShowBuildOutputs(storage), false);
  assert.equal(preference.getShowBuildOutputs(null), false);
  // Round trip: there is no per-root parameter any more, so every "root"
  // sees the same value.
  preference.setShowBuildOutputs(true, storage, null);
  // Exactly one storage key is written, and it is the fixed global key:
  // no root-suffixed or %-encoded keys.
  assert.deepEqual(writtenKeys, [GLOBAL_STORAGE_KEY]);
  // Corrupt values degrade to off, never throw.
  const corruptStorage = {
    getItem: () => "maybe",
    setItem: () => {},
  };
  assert.equal(preference.getShowBuildOutputs(corruptStorage), false);
  // The lib source itself carries no root-suffix derivation.
  const libSource = await readFile(new URL("../lib/build-outputs-preference.ts", import.meta.url), "utf8");
  assert.ok(!libSource.includes("storageKeyFor"), "no per-root key derivation may remain");
  assert.ok(!libSource.includes("encodeURIComponent(root)"), "no root-encoded key may remain");
  assert.match(libSource, /const STORAGE_KEY = "pi-web:file-explorer:show-build-outputs";/);
  assert.ok(!libSource.includes("root: string"), "no root parameter may remain in the API");
});

test("the change event broadcast keeps every mounted explorer in sync", () => {
  // A browser-like event target: in Node tests the global `window` is absent,
  // so the target is injected exactly the way the component injects nothing
  // in the browser (where window exists by default).
  const target = new EventTarget();
  const seen = [];
  const unsubscribe = preference.subscribeShowBuildOutputs((change) => seen.push(change), target);
  try {
    preference.setShowBuildOutputs(true, memoryStorage(), target);
    // The detail carries only the value: no root field any more.
    assert.deepEqual(seen, [{ value: true }]);
  } finally {
    unsubscribe();
  }
  // After unsubscribe no further events arrive.
  preference.setShowBuildOutputs(false, memoryStorage(), target);
  assert.equal(seen.length, 1);
});

// Review B1 regression (pi#50): storage failures must FAIL CLOSED — the
// broadcast carries the effective value (false), never the optimistic one,
// and the checkbox agrees with what the explorers actually got.
test("a failed storage write broadcasts the effective false value (fail-closed)", () => {
  const events = [];
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota exceeded"); },
  };
  const target = {
    dispatchEvent: (event) => { events.push(event.detail); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  setShowBuildOutputs(true, failingStorage, target);
  assert.deepEqual(events, [{ value: false }],
    "the broadcast must carry the effective (false) value when the write failed");

  // Throwing reads agree: getShowBuildOutputs degrades to false too.
  const throwingReadStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => {},
  };
  events.length = 0;
  setShowBuildOutputs(true, throwingReadStorage, target);
  assert.deepEqual(events, [{ value: false }]);

  // Null storage: same fail-closed contract.
  events.length = 0;
  setShowBuildOutputs(true, null, target);
  assert.deepEqual(events, [{ value: false }]);
});
