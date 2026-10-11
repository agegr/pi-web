import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The hook runs against a stand-in for React's hooks (one component,
// effects after each render) and mocked timers, so a phase can be played
// out to its end without a browser.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const {
  SIDEBAR_MOTION_GRACE_MS,
  SIDEBAR_MOTION_MS,
  archiveViewState,
  filesFoldState,
  prefersReducedMotion,
  useSidebarMotion,
} = await jiti.import("./useSidebarMotion.ts");

const LAST = SIDEBAR_MOTION_MS + SIDEBAR_MOTION_GRACE_MS;

function withMotion(reduce) {
  globalThis.window = { matchMedia: (query) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" }) };
}

test.beforeEach(() => {
  withMotion(false);
  mock.timers.enable({ apis: ["setTimeout"] });
});

test.afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
});

test("a phase runs from its start to its element's end event", () => {
  const view = renderHook(() => useSidebarMotion());
  assert.equal(view.result.phase, null, "nothing moves on mount");
  view.result.start("in");
  view.flush();
  assert.equal(view.result.phase, "in");
  view.result.end();
  view.flush();
  assert.equal(view.result.phase, null);
  view.result.start("out");
  view.flush();
  assert.equal(view.result.phase, "out");
  view.unmount();
});

test("without an end event (an element that never moved) the phase ends a little after the motion", () => {
  const view = renderHook(() => useSidebarMotion());
  view.result.start("out");
  view.flush();
  mock.timers.tick(SIDEBAR_MOTION_MS);
  view.flush();
  assert.equal(view.result.phase, "out", "the motion's own time is the end event's");
  mock.timers.tick(SIDEBAR_MOTION_GRACE_MS);
  view.flush();
  assert.equal(view.result.phase, null);
  view.unmount();
});

test("a start during a phase replaces it, with a time of its own", () => {
  const view = renderHook(() => useSidebarMotion());
  view.result.start("out");
  view.flush();
  mock.timers.tick(LAST - 50);
  view.result.start("in");
  view.flush();
  mock.timers.tick(100);
  view.flush();
  assert.equal(view.result.phase, "in", "the first phase's fallback is gone");
  mock.timers.tick(LAST);
  view.flush();
  assert.equal(view.result.phase, null);
  view.unmount();
});

test("under prefers-reduced-motion no phase starts: every change is instant", () => {
  withMotion(true);
  assert.equal(prefersReducedMotion(), true);
  const view = renderHook(() => useSidebarMotion());
  view.result.start("in");
  view.flush();
  assert.equal(view.result.phase, null);
  view.unmount();
  withMotion(false);
  assert.equal(prefersReducedMotion(), false);
  delete globalThis.window;
  assert.equal(prefersReducedMotion(), false, "no window: the server's render");
});

test("unmounting drops a running phase's fallback", () => {
  const view = renderHook(() => useSidebarMotion());
  view.result.start("in");
  view.flush();
  view.unmount();
  mock.timers.tick(LAST * 2);
  view.flush();
  assert.equal(view.result.phase, "in", "no state set after unmount");
});

test("the files section: still, today's states; folding, the body shown and inert; unfolding, shown at once", () => {
  for (const collapsed of [false, true]) {
    const still = { bodyHidden: collapsed, bodyInert: false, moving: false, open: !collapsed };
    assert.deepEqual(filesFoldState(collapsed, null), still);
    // A phase that does not match the state (a repeat) changes nothing.
    assert.deepEqual(filesFoldState(collapsed, collapsed ? "in" : "out"), still);
  }
  // Folding: the body stays to the end, inert, the separator gone at once.
  assert.deepEqual(filesFoldState(true, "out"), { bodyHidden: false, bodyInert: true, moving: true, open: false });
  // Unfolding: the body shows first and takes clicks; the separator and a
  // focus request wait for the end.
  assert.deepEqual(filesFoldState(false, "in"), { bodyHidden: false, bodyInert: false, moving: true, open: false });
});

test("the archive view: still, today's states; entering over an inert tree; leaving inert over the tree", () => {
  for (const open of [false, true]) {
    const still = { mainHidden: open, mainInert: false, archiveMounted: open, archiveInert: false, archiveClass: null };
    assert.deepEqual(archiveViewState(open, null), still);
    assert.deepEqual(archiveViewState(open, open ? "out" : "in"), still);
  }
  // In: the tree stays under it, inert, and is hidden only once the view is in.
  assert.deepEqual(archiveViewState(true, "in"), { mainHidden: false, mainInert: true, archiveMounted: true, archiveInert: false, archiveClass: "is-entering" });
  // Out: the tree is back at once; the view stays mounted, inert, to its end.
  assert.deepEqual(archiveViewState(false, "out"), { mainHidden: false, mainInert: false, archiveMounted: true, archiveInert: true, archiveClass: "is-leaving" });
});
