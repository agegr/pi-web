import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");

test("vertical panels use vertical pointer movement, cursor, keys, and separator orientation", () => {
  assert.match(source, /axis === "vertical" \? event\.clientY : event\.clientX/);
  assert.match(source, /axis === "vertical" \? "row-resize" : "col-resize"/);
  assert.match(source, /axis === "vertical" \? "ArrowDown" : "ArrowRight"/);
  assert.match(source, /axis === "vertical" \? "ArrowUp" : "ArrowLeft"/);
  assert.match(source, /axis === "vertical" \? "horizontal" as const : "vertical" as const/);
});

test("resized values continue to persist and reset through the shared panel contract", () => {
  assert.match(source, /writeStoredWidth\(storageKey, nextWidth\)/);
  assert.match(source, /onDoubleClick: resetWidth/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /window\.addEventListener\("resize", onResize\)/);
});

// The hook runs here against a stand-in for React's hooks (one component,
// effects after each render), a window whose size is a variable and a Map for
// localStorage, so what each path shows and saves can be played out.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useResizablePanel } = await jiti.import("./useResizablePanel.ts");

function emitter(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); },
  };
}

const KEY = "test-panel-height";
const stored = new Map();
globalThis.window = emitter({
  localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  },
});
globalThis.document = emitter({ body: { style: { cursor: "", userSelect: "" } } });

// One panel at a time: the previous test's stops listening to the window.
let mounted = null;

function mount({ storedHeight, persistClamp, room }) {
  mounted?.unmount();
  stored.clear();
  if (storedHeight !== undefined) stored.set(KEY, String(storedHeight));
  const space = { room };
  const widthRef = { current: 0 };
  const view = renderHook(() => useResizablePanel({
    ariaLabel: "Resize",
    axis: "vertical",
    cssVariable: "--test-height",
    defaultWidth: 240,
    getMaxWidth: () => space.room,
    growthDirection: "down",
    maxWidth: 800,
    minWidth: 120,
    persistClamp,
    storageKey: KEY,
    widthRef,
  }));
  mounted = view;
  const resize = (nextRoom) => {
    space.room = nextRoom;
    window.emit("resize");
    view.flush();
  };
  const key = (name, shiftKey = false) => {
    view.result.separatorProps.onKeyDown({ key: name, shiftKey, preventDefault() {} });
    view.flush();
  };
  return { view, resize, key, shown: () => view.result.width, saved: () => stored.get(KEY) };
}

test("by default a window too short for the stored size saves the smaller one (both AppShell panels)", () => {
  const panel = mount({ storedHeight: 400, room: 300 });
  assert.equal(panel.shown(), 300);
  assert.equal(panel.saved(), "300");
  panel.resize(250);
  assert.equal(panel.saved(), "250");
  panel.resize(600);
  assert.equal(panel.shown(), 250, "the stored size was lost");
});

test("without persistClamp a short window shows less, saves nothing and grows back", () => {
  const panel = mount({ storedHeight: 400, persistClamp: false, room: 300 });
  assert.equal(panel.shown(), 300);
  assert.equal(panel.saved(), "400");
  panel.resize(250);
  assert.equal(panel.shown(), 250);
  panel.view.result.reclampWidth();
  panel.view.flush();
  assert.equal(panel.saved(), "400");
  panel.resize(600);
  assert.equal(panel.shown(), 400, "back to the user's size");
  panel.resize(1000);
  assert.equal(panel.shown(), 400, "never past it");
  assert.equal(panel.saved(), "400");
});

test("without persistClamp keys and a reset are the user's choice and are saved", () => {
  const panel = mount({ storedHeight: 400, persistClamp: false, room: 300 });
  panel.key("ArrowUp");
  assert.equal(panel.shown(), 288, "shrinks from the size shown");
  assert.equal(panel.saved(), "288");
  panel.resize(600);
  assert.equal(panel.shown(), 288, "the new choice replaced the old one");
  panel.key("End");
  assert.equal(panel.saved(), "600");
  panel.resize(300);
  panel.key("ArrowDown", true);
  assert.equal(panel.shown(), 300, "the window still caps what shows");
  assert.equal(panel.saved(), "632", "a grow starts from the user's size, not the capped one");
  panel.key("End");
  assert.equal(panel.saved(), "632", "End never lowers it either");
  assert.equal(panel.shown(), 300);
  panel.key("Home");
  assert.equal(panel.saved(), "120");
  panel.key("Enter");
  assert.equal(panel.shown(), 240);
  assert.equal(panel.saved(), "240");
});

const separatorTarget = {
  focus() {},
  setPointerCapture() {},
  hasPointerCapture: () => false,
  releasePointerCapture() {},
  setAttribute() {},
};
const pointer = (clientY, extra = {}) => ({
  pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientY, clientX: 0,
  currentTarget: separatorTarget, preventDefault() {}, stopPropagation() {}, ...extra,
});

test("without persistClamp a drag saves where it ends, and a resize during it leaves it alone", () => {
  const panel = mount({ persistClamp: false, room: 500 });
  assert.equal(panel.shown(), 240);
  assert.equal(panel.saved(), undefined, "the default is not written on mount");
  const props = () => panel.view.result.separatorProps;
  props().onPointerDown(pointer(100));
  panel.view.flush();
  props().onPointerMove(pointer(160));
  panel.resize(500);
  assert.equal(panel.shown(), 300, "the size under the pointer, not the saved one");
  props().onPointerMove(pointer(180));
  props().onPointerUp(pointer(180));
  panel.view.flush();
  assert.equal(panel.shown(), 320);
  assert.equal(panel.saved(), "320");
  assert.equal(document.body.style.cursor, "");
});

test("without persistClamp a click on the separator saves nothing", () => {
  const panel = mount({ storedHeight: 400, persistClamp: false, room: 300 });
  const props = () => panel.view.result.separatorProps;
  props().onPointerDown(pointer(100));
  panel.view.flush();
  props().onPointerUp(pointer(100));
  panel.view.flush();
  assert.equal(panel.shown(), 300);
  assert.equal(panel.saved(), "400", "not the short window's clamp");
  panel.resize(1000);
  assert.equal(panel.shown(), 400, "back to the user's size");
});
