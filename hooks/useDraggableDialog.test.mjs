import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

// A hook consumer with controlled DOM geometry; real pointer/render behavior is
// separately exercised in Chrome against both actual extension dialog variants.
test("extension dialog drag stays bounded, respects controls, resets on narrow layout and releases every capture", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dialog-drag-test-"));
  const shimPath = path.join(dir, "react-hooks.mjs");
  writeFileSync(shimPath, `let refs=[],cursor=0,effects=[];
export const useRef=(value)=>refs[cursor++]??(refs[cursor-1]={current:value});
export const useCallback=(fn)=>fn;
export const useSyncExternalStore=(_subscribe,getSnapshot)=>getSnapshot();
export const useLayoutEffect=(fn)=>effects.push(fn);
export function render(fn){cursor=0;return fn();}
export function flush(){const setup=effects;effects=[];return setup.map(fn=>fn()).filter(Boolean);}
`);
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { react: shimPath } });
  const react = await jiti.import(shimPath);
  const { useDraggableDialog } = await jiti.import("./useDraggableDialog.ts");
  const saved = Object.fromEntries(["window", "document", "ResizeObserver", "getComputedStyle"].map(k => [k, globalThis[k]]));
  const listeners = new Map(); const observers = []; let mobile = false; let size = { width: 560, height: 240 };
  const listen = (prefix) => ({ addEventListener: (key, fn) => listeners.set(prefix + key, fn), removeEventListener: key => listeners.delete(prefix + key) });
  const body = { style: { cursor: "auto", userSelect: "text" } };
  globalThis.window = { ...listen("window:"), matchMedia: () => ({ matches: mobile }) };
  globalThis.document = { ...listen("document:"), body, visibilityState: "visible" };
  globalThis.getComputedStyle = () => ({ paddingLeft: "20", paddingRight: "20", paddingTop: "20", paddingBottom: "20" });
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  const captured = new Set(); const header = { closest: () => null, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
  const attrs = new Set(); const surface = { getBoundingClientRect: () => size, style: { transform: "", removeProperty(key) { this[key] = ""; } }, setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k) };
  const event = (extra = {}) => ({ pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, clientX: 300, clientY: 200, currentTarget: header, target: header, preventDefault() {}, stopPropagation() {}, ...extra });
  let cleanups = [];
  const render = (collapsed = false) => { cleanups.forEach(fn => fn()); const hook = react.render(() => useDraggableDialog(collapsed)); hook.containerRef.current = { clientWidth: 1000, clientHeight: 600 }; hook.dialogRef.current = surface; cleanups = react.flush(); return hook; };
  try {
    let drag = render();
    drag.handleProps.onPointerDown(event({ target: { closest: () => ({ tagName: "BUTTON" }) } }));
    assert.equal(captured.size, 0, "header action buttons are not drag handles");
    drag.handleProps.onPointerDown(event());
    assert.equal(body.style.cursor, "grabbing"); assert.equal(captured.size, 1);
    drag.handleProps.onPointerMove(event({ clientX: 1500, clientY: 1200 }));
    assert.equal(surface.style.transform, "translate(200px, 160px)");
    drag.handleProps.onPointerUp(event());
    assert.equal(captured.size, 0); assert.equal(body.style.cursor, "auto"); assert.equal(body.style.userSelect, "text");
    drag.gripProps.onKeyDown({ key: "Home", nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    assert.equal(surface.style.transform, "");
    drag.gripProps.onKeyDown({ key: "ArrowRight", nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    drag.gripProps.onKeyDown({ key: "ArrowDown", shiftKey: true, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    assert.equal(surface.style.transform, "translate(12px, 32px)");
    drag = render(true); drag = render(false);
    assert.equal(surface.style.transform, "translate(12px, 32px)", "collapse/restore preserves the bounded offset");
    size = { width: 960, height: 560 }; observers.at(-1).fn();
    assert.equal(surface.style.transform, "", "maximized official surface remains fully inside padding");
    size = { width: 560, height: 240 };
    drag.handleProps.onPointerDown(event()); listeners.get("window:blur")();
    assert.equal(captured.size, 0); assert.equal(body.style.cursor, "auto");
    drag.handleProps.onPointerDown(event()); globalThis.document.visibilityState = "hidden"; listeners.get("document:visibilitychange")();
    assert.equal(captured.size, 0); globalThis.document.visibilityState = "visible";
    drag.handleProps.onPointerDown(event()); drag.handleProps.onPointerCancel(event()); assert.equal(captured.size, 0);
    drag.handleProps.onPointerDown(event()); drag.handleProps.onLostPointerCapture(event()); assert.equal(captured.size, 0);
    mobile = true; drag = render(); assert.equal(drag.enabled, false); assert.equal(surface.style.transform, "");
    drag.handleProps.onPointerDown(event()); assert.equal(captured.size, 0);
    mobile = false; drag = render(); drag.handleProps.onPointerDown(event());
    cleanups.forEach(fn => fn()); cleanups = [];
    assert.equal(captured.size, 0); assert.equal(body.style.cursor, "auto"); assert.equal(body.style.userSelect, "text");
    assert.equal(listeners.size, 0); assert.ok(observers.every(o => o.disconnected));
  } finally {
    cleanups.forEach(fn => fn());
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
});
