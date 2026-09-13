import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("shares one guarded older-page loader between the sentinel and the minimap", () => {
  const loader = source.slice(
    source.indexOf("const loadOlderPage = useCallback"),
    source.indexOf("// IntersectionObserver on the sentinel div"),
  );

  assert.match(loader, /if \(loadingOlderRef\.current\) return/);
  assert.match(loader, /if \(!hasEarlierMessages\) return/);
  assert.match(loader, /const oldestId = historyCursor/);
  assert.match(loader, /prevScrollDistanceRef\.current = captureScrollDistance/);
  assert.match(loader, /loadingOlderRef\.current = true/);
  assert.match(loader, /setLoadingEarlier\(true\)/);
  assert.match(loader, /await loadContext\(sid, activeLeafId, oldestId\)/);
  assert.match(
    loader,
    /finally \{[\s\S]*?loadingOlderRef\.current = false;[\s\S]*?setLoadingEarlier\(false\)/,
  );

  // The sentinel keeps its observer but delegates the fetch to the shared loader.
  const observer = source.slice(
    source.indexOf("// IntersectionObserver on the sentinel div"),
    source.indexOf("// Keep the rendered window at least as large"),
  );
  assert.match(observer, /void loadOlderPage\(\)/);
  assert.doesNotMatch(observer, /loadContext\(/);
});

test("passes older-history state and the loader to the minimap", () => {
  const minimap = source.slice(
    source.indexOf("<ChatMinimap\n"),
    source.indexOf("onLoadEarlier={loadOlderPage}"),
  );

  assert.match(minimap, /hasEarlierMessages=\{hasEarlierMessages\}/);
  assert.match(minimap, /loadingEarlier=\{loadingEarlier\}/);
  assert.match(source, /onLoadEarlier=\{loadOlderPage\}/);
});
