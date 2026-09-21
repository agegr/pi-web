import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// pi#16 regression guards: the upward-pagination scroll anchoring must not
// depend on visibleCount changing, and the sentinel IntersectionObserver must
// not be re-created on every loaded page. Both defects together made one
// upward pull cascade page loads into distant history.

test("scroll anchor restore runs on a prepend even when visibleCount already exceeds messages.length", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const effect = source.match(/useEffect\(\(\) => \{\n    const snapshot = prevScrollAnchorRef\.current;[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(effect, "scroll anchor restore effect must read the captured snapshot");
  assert.match(effect[0], /shouldRestoreScrollAnchor\(/);
  assert.match(effect[0], /restoreScrollTop\(container\.scrollHeight, snapshot\.distance\)/);
  assert.match(effect[0], /\}, \[visibleCount, messages\.length, scrollContainerRef\]\);/,
    "the restore effect must be keyed on messages.length: after the scroll-position restore, search-locate, or minimap-reveal paths inflate visibleCount beyond messages.length, a prepend alone no longer changes visibleCount");
});

test("sentinel observer is created once per sentinel lifecycle and reads cursor state from the history ref", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const effect = source.match(/useEffect\(\(\) => \{\n    const sentinel = sentinelRef\.current;[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(effect, "sentinel observer effect must exist");
  assert.match(effect[0], /const history = searchHistoryRef\.current;/,
    "the observer callback must read the history cursor via searchHistoryRef");
  assert.match(effect[0], /if \(!history\.hasEarlierMessages\) return;/);
  assert.match(effect[0], /const oldestId = history\.historyCursor;/);
  assert.doesNotMatch(effect[0], /historyCursor,/, "the effect deps must not include the history cursor");
  assert.match(effect[0], /\}, \[hasEarlierMessages, session, activeLeafId, loadContext, sessionIdRef, scrollContainerRef\]\);/,
    "hasEarlierMessages gates the sentinel's existence, so the observer is created when it flips; the cursor must stay out of the deps so pages do not re-arm the observer");
});

test("pagination captures a full scroll anchor snapshot, not a bare distance", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/captureScrollAnchor\(/g) ?? []).length, 2,
    "both upward-load capture sites (sentinel and search-locate) must capture the DOM fingerprint");
  assert.doesNotMatch(source, /captureScrollDistance\(/);
  assert.match(source, /const prevScrollAnchorRef = useRef<ScrollAnchorSnapshot \| null>\(null\);/);
});
