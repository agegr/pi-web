import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  return import(new URL("../lib/sidebar-width.ts", import.meta.url).href);
}

test("sidebar drag width updates are clamped and only change when width actually changes", async () => {
  const { createSidebarWidthTracker } = await loadModule();
  const tracker = createSidebarWidthTracker({ min: 220, max: 520 });

  const widths = [];
  widths.push(tracker.next(260));
  widths.push(tracker.next(260));
  widths.push(tracker.next(700));
  widths.push(tracker.next(100));

  assert.deepStrictEqual(widths, [
    { changed: true, width: 260 },
    { changed: false, width: 260 },
    { changed: true, width: 520 },
    { changed: true, width: 220 },
  ]);
});
