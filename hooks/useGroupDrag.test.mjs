import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The drag state machine runs here against a stand-in for React's hooks (one
// component, effects run after each render) and a stand-in for the few DOM
// objects it touches, so its gestures can be played out without a browser.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const {
  AUTO_SCROLL_MAX_STEP,
  DRAG_START_PX,
  GHOST_GAP_PX,
  GHOST_LINE_GAP_PX,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  useGroupDrag,
} = await jiti.import("./useGroupDrag.ts");
const { buildSessionTree, getRowOffsets } = await jiti.import("@/lib/session-tree.ts");
const source = await readFile(new URL("./useGroupDrag.ts", import.meta.url), "utf8");

function emitter(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
      return event;
    },
    count() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

class FakeElement {
  constructor(inActions = false) {
    this.inActions = inActions;
  }

  closest(selector) {
    return this.inActions && selector === ".session-tree-group-actions" ? this : null;
  }
}

const frames = new Map();
let frameId = 0;
globalThis.Element = FakeElement;
globalThis.window = emitter({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});
globalThis.document = emitter({ visibilityState: "visible" });
globalThis.requestAnimationFrame = (fn) => {
  frames.set(++frameId, fn);
  return frameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);

function runFrames(count) {
  for (let index = 0; index < count; index++) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, fn] of pending) fn();
  }
}

const BASE = Date.parse("2026-10-01T00:00:00.000Z");
const SCROLL_TOP_EDGE = 100;

function session(id, project, modified) {
  const time = new Date(modified).toISOString();
  return { path: `${project}/${id}.jsonl`, id, cwd: project, projectRoot: project, projectKey: project, created: time, modified: time, messageCount: 1, firstMessage: id };
}

function model(projects) {
  return buildSessionTree({
    sessions: projects.map((project, index) => session(`s${index}`, project, BASE - index)),
    uiState: { version: 1, revision: 0, sessions: {}, projects: {}, projectOrder: projects },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
  });
}

const GHOST_HEIGHT = 22;
const TREE_TOP = 60;

/** A tree of collapsed groups (28px header, 8px spacer) in a list box 100px from the top of the page. */
function setup({ projects = ["/a", "/b", "/c"], clientHeight = 400, enabled = true } = {}) {
  const { rows } = model(projects);
  const offsets = getRowOffsets(rows, "desktop");
  const scroll = emitter({
    scrollTop: 0,
    clientHeight,
    hidden: false,
    getBoundingClientRect() {
      return { top: SCROLL_TOP_EDGE, bottom: SCROLL_TOP_EDGE + this.clientHeight, left: 0, right: 240, width: 240, height: this.clientHeight };
    },
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
  });
  const inner = { getBoundingClientRect: () => ({ top: SCROLL_TOP_EDGE - scroll.scrollTop }) };
  const tree = { getBoundingClientRect: () => ({ top: TREE_TOP, left: 0 }) };
  const ghost = { style: {}, offsetHeight: GHOST_HEIGHT };
  const moves = [];
  const props = {
    rows,
    offsets,
    layout: "desktop",
    enabled,
    scrollRef: { current: scroll },
    innerRef: { current: inner },
    treeRef: { current: tree },
    ghostRef: { current: ghost },
    onMove: (...move) => moves.push(move),
  };
  const hook = renderHook(useGroupDrag, props);
  mounted.push(hook);
  const rowTop = (key) => offsets[rows.findIndex((row) => row.key === `group:${key}`)];
  const header = (key) => {
    const captured = new Set();
    return {
      isConnected: true,
      captured,
      getBoundingClientRect: () => ({ top: SCROLL_TOP_EDGE + rowTop(key) - scroll.scrollTop, left: 6, width: 228, height: 28 }),
      setPointerCapture: (id) => captured.add(id),
      hasPointerCapture: (id) => captured.has(id),
      releasePointerCapture: (id) => captured.delete(id),
    };
  };
  /** Content y to page y. */
  const at = (y) => SCROLL_TOP_EDGE + y - scroll.scrollTop;
  let time = 1000;
  const press = (key, { y = at(rowTop(key) + 10), x = 50, pointerType = "mouse", pointerId = 1, button = 0, ctrlKey = false, isPrimary = true, target = new FakeElement() } = {}) => {
    const element = header(key);
    hook.result.handlers.onPointerDown({ isPrimary, button, ctrlKey, pointerId, pointerType, clientX: x, clientY: y, currentTarget: element, target }, key);
    hook.flush();
    return element;
  };
  const move = (y, { x = 50, pointerId = 1, pointerType = "mouse", buttons = 1 } = {}) => {
    window.emit("pointermove", { pointerId, pointerType, buttons, clientX: x, clientY: y });
    hook.flush();
  };
  const release = (y, { pointerId = 1 } = {}) => {
    time += 10;
    window.emit("pointerup", { pointerId, clientX: 50, clientY: y, timeStamp: time });
    hook.flush();
  };
  const click = (delay = 5) => {
    const event = { timeStamp: time + delay, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    hook.result.onClickCapture(event);
    return event.prevented && event.stopped;
  };
  const key = (name) => {
    const event = { key: name, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    window.emit("keydown", event);
    hook.flush();
    return event;
  };
  const touchMove = ({ cancelable = true } = {}) => {
    const event = { cancelable, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    hook.result.handlers.onTouchMove(event);
    hook.flush();
    return event.defaultPrevented;
  };
  return { hook, props, rows, offsets, scroll, ghost, moves, rowTop, at, press, move, release, click, key, touchMove };
}

// A failed test must not leave its listeners to the next one.
const mounted = [];
test.afterEach(() => {
  for (const hook of mounted.splice(0)) hook.unmount();
  frames.clear();
});

test("a mouse press that does not move is a click: no drag, and the click goes through", () => {
  const tree = setup();
  const y = tree.at(tree.rowTop("/b") + 10);
  tree.press("/b", { y });
  assert.ok(window.count() > 0, "listening while pressed");
  tree.move(y + DRAG_START_PX - 1);
  assert.equal(tree.hook.result.view, null);
  tree.release(y + DRAG_START_PX - 1);
  assert.deepEqual(tree.moves, []);
  assert.equal(tree.click(), false, "the group toggles");
  assert.equal(window.count() + document.count(), 0, "every listener is gone");
  tree.hook.unmount();
});

test("a mouse drag starts after a few pixels, follows the pointer and drops next to the target", () => {
  const tree = setup();
  const start = tree.at(tree.rowTop("/a") + 10);
  const element = tree.press("/a", { y: start });
  tree.move(start + DRAG_START_PX);
  const view = tree.hook.result.view;
  assert.equal(view.phase, "dragging");
  assert.equal(view.projectKey, "/a");
  assert.deepEqual(view.source, { key: "/a", pinned: false, top: 0, bottom: 36 });
  assert.equal(view.drop, null, "still over itself");
  assert.ok(element.captured.has(1), "the header holds the pointer");
  // The ghost is placed in the tree's box, its left edge 4px in from the
  // header's (left 6), its width its name's (CSS). No room above the pointer
  // at the list's top: it goes below.
  assert.equal(tree.ghost.style.top, `${start + DRAG_START_PX + GHOST_GAP_PX.mouse - TREE_TOP}px`);
  assert.equal(tree.ghost.style.left, "10px");
  assert.equal(tree.ghost.style.width, undefined);
  assert.equal(tree.ghost.style.height, undefined);

  // Past the middle of /c (72..108): after it. The line (page y 204) is
  // below the pointer: the ghost's bottom keeps the gap above the pointer.
  tree.move(tree.at(95));
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/c", position: "after", lineY: 104 });
  assert.equal(tree.ghost.style.top, `${tree.at(95) - GHOST_GAP_PX.mouse - GHOST_HEIGHT - TREE_TOP}px`);
  // The line (68) just above the pointer (70): the ghost goes above the new
  // line, not the last one.
  tree.move(tree.at(70));
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/b", position: "after", lineY: 68 });
  assert.equal(tree.ghost.style.top, `${tree.at(68) - GHOST_LINE_GAP_PX - GHOST_HEIGHT - TREE_TOP}px`);
  // The line below the pointer: back to the pointer.
  tree.move(tree.at(60));
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/b", position: "after", lineY: 68 });
  assert.equal(tree.ghost.style.top, `${tree.at(60) - GHOST_GAP_PX.mouse - GHOST_HEIGHT - TREE_TOP}px`);
  tree.release(tree.at(95));
  assert.deepEqual(tree.moves, [["/a", "/c", "after"]], "the drop is taken where the pointer is let go");
  assert.equal(tree.hook.result.view, null);
  assert.equal(element.captured.size, 0, "capture released");
  assert.equal(window.count() + document.count() + tree.scroll.count(), 0);
  assert.equal(tree.click(), true, "the release's click does not toggle the group");
  assert.equal(tree.click(), false, "only that one click");
  tree.hook.unmount();
});

test("a click long after a drop, or after a new press, is the user's own", () => {
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start });
  tree.move(start + 20);
  tree.release(start + 20);
  assert.equal(tree.click(1000), false, "too late to be the release's");
  tree.press("/a", { y: start });
  tree.move(start + 20);
  tree.release(start + 20);
  tree.hook.result.onPointerDownCapture();
  assert.equal(tree.click(), false);
  tree.hook.unmount();
});

test("Escape puts a dragged group back, and is left alone before the drag starts", () => {
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start });
  const early = tree.key("Escape");
  assert.equal(early.defaultPrevented, false, "a press not picked up lets Escape stop the agent");
  tree.move(tree.at(95));
  assert.equal(tree.hook.result.view.phase, "dragging");
  assert.equal(tree.key("Enter").defaultPrevented, false);
  const escape = tree.key("Escape");
  assert.ok(escape.defaultPrevented && escape.stopped, "marked handled for handleGlobalEscape");
  assert.equal(tree.hook.result.view, null);
  tree.move(tree.at(60));
  assert.equal(tree.hook.result.view, null, "cancelled stays cancelled");
  tree.release(tree.at(95));
  assert.deepEqual(tree.moves, []);
  assert.equal(tree.click(), true, "its click is still eaten");
  assert.equal(window.count(), 0);
  tree.hook.unmount();
});

test("a press whose release never came back ends on the next move without buttons", () => {
  const tree = setup();
  tree.press("/b");
  tree.move(tree.at(90), { buttons: 0 });
  assert.equal(tree.hook.result.view, null);
  assert.equal(window.count() + document.count(), 0);
  tree.hook.unmount();
});

test("presses that are no drag: other buttons, Ctrl, a second pointer, the group's own buttons, a disabled tree", () => {
  const tree = setup();
  for (const options of [{ button: 2 }, { ctrlKey: true }, { isPrimary: false }, { target: new FakeElement(true) }]) {
    tree.press("/a", options);
    assert.equal(window.count(), 0, JSON.stringify(options));
  }
  tree.hook.unmount();
  const disabled = setup({ enabled: false });
  disabled.press("/a");
  assert.equal(window.count(), 0);
  disabled.hook.unmount();
});

test("a second pointer or the window losing focus ends a drag", () => {
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start });
  tree.move(start + 20);
  window.emit("pointerdown", { pointerId: 2 });
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null);
  tree.release(start + 20);
  assert.deepEqual(tree.moves, []);
  tree.press("/a", { y: start });
  tree.move(start + 20);
  window.emit("blur", {});
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null);
  assert.equal(window.count() + document.count(), 0);
  tree.hook.unmount();
});

test("touch: a swipe scrolls, a long-press picks the group up and holds the list still", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tree = setup();
  const start = tree.at(15);
  // A swipe before the long-press: the press lets go and the browser scrolls.
  tree.press("/a", { y: start, pointerType: "touch" });
  assert.equal(tree.touchMove(), false, "the list may scroll while nothing is picked up");
  tree.move(start + LONG_PRESS_SLOP_PX + 1, { pointerType: "touch" });
  assert.equal(window.count(), 0);
  t.mock.timers.tick(LONG_PRESS_MS);
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null, "the timer went with the press");

  const element = tree.press("/a", { y: start, pointerType: "touch" });
  t.mock.timers.tick(LONG_PRESS_MS - 1);
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null);
  t.mock.timers.tick(1);
  tree.hook.flush();
  assert.deepEqual(tree.hook.result.view, { projectKey: "/a", phase: "armed", drop: null, source: null });
  assert.equal(tree.touchMove(), true, "picked up: the finger no longer scrolls the list");
  // An uncancelable move inside Chrome's slop, with the list where it was, is no scroll.
  assert.equal(tree.touchMove({ cancelable: false }), false);
  assert.equal(tree.hook.result.view.phase, "armed");
  tree.move(start + DRAG_START_PX, { pointerType: "touch" });
  assert.equal(tree.hook.result.view.phase, "dragging");
  assert.equal(element.captured.size, 0, "touch keeps its implicit capture");
  tree.move(tree.at(95), { pointerType: "touch" });
  assert.equal(tree.ghost.style.top, `${tree.at(95) - GHOST_GAP_PX.touch - GHOST_HEIGHT - TREE_TOP}px`, "farther from a finger");
  tree.release(tree.at(95));
  assert.deepEqual(tree.moves, [["/a", "/c", "after"]]);
  assert.equal(tree.click(), true);

  // Picked up and let go without moving: nothing moves, the tap does not toggle.
  tree.press("/b", { y: tree.at(50), pointerType: "touch" });
  t.mock.timers.tick(LONG_PRESS_MS);
  tree.hook.flush();
  tree.release(tree.at(50));
  assert.equal(tree.moves.length, 1);
  assert.equal(tree.click(), true);

  // The browser scrolled anyway (an uncancelable move and a moved list): the drag ends.
  tree.press("/b", { y: tree.at(50), pointerType: "touch" });
  t.mock.timers.tick(LONG_PRESS_MS);
  tree.hook.flush();
  tree.scroll.scrollTop = 30;
  tree.touchMove({ cancelable: false });
  assert.equal(tree.hook.result.view, null);
  assert.equal(window.count(), 0);
  tree.hook.unmount();
});

test("a pen takes the long-press path, not the mouse's threshold", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start, pointerType: "pen" });
  tree.move(start + DRAG_START_PX + 2, { pointerType: "pen" });
  assert.equal(tree.hook.result.view, null, "no drag from a pen stroke");
  t.mock.timers.tick(LONG_PRESS_MS);
  tree.hook.flush();
  assert.equal(tree.hook.result.view.phase, "armed");
  window.emit("pointercancel", { pointerId: 1 });
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null);
  assert.equal(window.count(), 0);
  tree.hook.unmount();
});

test("the context menu ends a press not picked up yet and is held back after", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tree = setup();
  const menu = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    window.emit("contextmenu", event);
    tree.hook.flush();
    return event.prevented;
  };
  tree.press("/a", { pointerType: "touch" });
  assert.equal(menu(), false);
  assert.equal(window.count(), 0);
  tree.press("/a", { pointerType: "touch" });
  t.mock.timers.tick(LONG_PRESS_MS);
  tree.hook.flush();
  assert.equal(menu(), true, "Android's long-press menu does not open over the drag");
  assert.equal(tree.hook.result.view.phase, "armed");
  tree.hook.unmount();
});

test("new rows without the dragged group cancel it; with it, the drop is taken again", () => {
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start });
  tree.move(tree.at(95));
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/c", position: "after", lineY: 104 });
  // /d joins at the bottom: the pointer is now over /d's upper half.
  const grown = model(["/a", "/b", "/c", "/d"]);
  tree.hook.rerender({ ...tree.props, rows: grown.rows, offsets: getRowOffsets(grown.rows, "desktop") });
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/c", position: "after", lineY: 104 });
  tree.move(tree.at(130));
  assert.deepEqual(tree.hook.result.view.drop, { anchorKey: "/d", position: "after", lineY: 140 });
  const gone = model(["/b", "/c", "/d"]);
  tree.hook.rerender({ ...tree.props, rows: gone.rows, offsets: getRowOffsets(gone.rows, "desktop") });
  assert.equal(tree.hook.result.view, null, "archived in another window");
  tree.release(tree.at(130));
  assert.deepEqual(tree.moves, []);
  assert.equal(tree.click(), true);
  tree.hook.unmount();
});

test("a drag stops when the tree is disabled or hidden", () => {
  const tree = setup();
  const start = tree.at(15);
  tree.press("/a", { y: start });
  tree.move(start + 20);
  tree.hook.rerender({ ...tree.props, enabled: false });
  assert.equal(tree.hook.result.view, null, "loading");
  tree.release(start + 20);
  tree.hook.rerender({ ...tree.props, enabled: true });
  tree.press("/a", { y: start });
  tree.move(start + 20);
  tree.scroll.hidden = true;
  runFrames(1);
  tree.hook.flush();
  assert.equal(tree.hook.result.view, null, "the archive view or the files tab hid it");
  tree.release(start + 20);
  assert.deepEqual(tree.moves, []);
  tree.hook.unmount();
});

test("near an edge the list scrolls, never past the rows' own height", () => {
  const projects = Array.from({ length: 12 }, (_, index) => `/p${index}`);
  const tree = setup({ projects, clientHeight: 100 });
  const content = tree.offsets[tree.offsets.length - 1];
  const start = tree.at(15);
  tree.press("/p0", { y: start });
  tree.move(start + 10);
  // Hold the pointer at the list's bottom edge.
  const bottom = SCROLL_TOP_EDGE + 100 - 1;
  tree.move(bottom);
  runFrames(1);
  assert.equal(tree.scroll.scrollTop, AUTO_SCROLL_MAX_STEP);
  runFrames(200);
  tree.hook.flush();
  assert.equal(tree.scroll.scrollTop, content - 100, "stops at the rows' height");
  assert.equal(tree.hook.result.view.drop.anchorKey, "/p11", "the target follows the scroll");
  // The pointer over the footer at the bottom edge, the line above it at the
  // band's end, both in view as the list scrolled: the ghost clears the line.
  const lineAt = tree.at(tree.hook.result.view.drop.lineY);
  assert.ok(lineAt < bottom && lineAt > SCROLL_TOP_EDGE);
  assert.equal(tree.ghost.style.top, `${lineAt - GHOST_LINE_GAP_PX - GHOST_HEIGHT - TREE_TOP}px`);
  tree.move(SCROLL_TOP_EDGE + 1);
  runFrames(1);
  assert.equal(tree.scroll.scrollTop, content - 100 - AUTO_SCROLL_MAX_STEP);
  tree.move(SCROLL_TOP_EDGE + 50);
  const held = tree.scroll.scrollTop;
  runFrames(3);
  assert.equal(tree.scroll.scrollTop, held, "still in the middle");
  tree.release(SCROLL_TOP_EDGE + 50);
  assert.equal(frames.size, 0, "no frame left running");
  tree.hook.unmount();
});

test("unmounting mid-drag removes every listener, timer and frame", () => {
  const tree = setup();
  tree.press("/a", { y: tree.at(15) });
  tree.move(tree.at(40));
  tree.hook.unmount();
  assert.equal(window.count() + document.count() + tree.scroll.count(), 0);
  assert.equal(frames.size, 0);
});

test("the hook's sources stay within the platform rules", () => {
  assert.doesNotMatch(source, /\(\?<[=!]/, "no RegExp lookbehind (Safari 16.2)");
  assert.doesNotMatch(source, /navigator\.vibrate|userSelect/, "no vibration (a console warning in Chrome) and no body style (Safari needs the prefix)");
  // The mouse's threshold path is for a mouse only; touch and pen long-press.
  assert.match(source, /if \(event\.pointerType !== "mouse"\) drag\.timer = window\.setTimeout\(arm, LONG_PRESS_MS\);/);
  assert.match(source, /if \(drag\.pointerType === "mouse" && event\.buttons === 0\) \{\s*teardown\(\);/);
  assert.match(source, /window\.addEventListener\("keydown", onKeyDown, true\);/);
  assert.match(source, /scroll\.addEventListener\("scroll", onScroll, \{ passive: true \}\);/);
  assert.equal(LONG_PRESS_MS, 350);
});
