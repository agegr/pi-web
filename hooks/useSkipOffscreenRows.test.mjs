import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createJiti } from "jiti";

// The layout half of #1808 needs a browser (the headless repro in the commit
// messages): a row whose child's margin collapsed through its edge grew by that
// margin when skipped and flipped back at the near band's edge every frame, and
// a sub-pixel difference in how the observer reads a plain and a skipped row
// did the same. This checks the bookkeeping around it with a stand-in DOM:
// rows are skipped past the far band and laid out inside the near one, and a
// skipped row that may have changed is laid out again and skipped at its new
// size only once a ResizeObserver reports that layout, never measured in the
// middle of the script that changed it.

class FakeStyle {
  setProperty(name, value) { this[name] = value; }
  removeProperty(name) {
    delete this[name];
    delete this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
  }
}

class FakeNode {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() { return this.parentNode; }
  append(child) {
    child.parentNode = this;
    this.childNodes.push(child);
  }
}

let layouts = 0;
class FakeElement extends FakeNode {
  constructor({ overflowY = "visible", height = 0 } = {}) {
    super();
    this.style = new FakeStyle();
    this.overflowY = overflowY;
    this.height = height;
  }
  get children() { return this.childNodes.filter((node) => node instanceof FakeElement); }
  getBoundingClientRect() {
    layouts++;
    return { height: this.height, width: 800 };
  }
}

const observers = { intersection: new Map(), resize: [], mutation: [] };
const fontListeners = new Set();
globalThis.HTMLElement = FakeElement;
globalThis.CSS = { supports: () => true };
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  get localStorage() { throw new Error("no storage"); },
};
globalThis.document = {
  documentElement: new FakeElement(),
  fonts: { addEventListener: (_, fn) => fontListeners.add(fn), removeEventListener: (_, fn) => fontListeners.delete(fn) },
};
globalThis.getComputedStyle = (element) => ({
  overflowY: element.overflowY,
  paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px",
});
globalThis.IntersectionObserver = class {
  constructor(callback, { rootMargin }) { this.callback = callback; this.observed = new Set(); observers.intersection.set(rootMargin, this); }
  observe(target) { this.observed.add(target); }
  unobserve(target) { this.observed.delete(target); }
  disconnect() { this.observed.clear(); }
};
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.observed = new Set(); observers.resize.push(this); }
  observe(target) { this.observed.add(target); }
  unobserve(target) { this.observed.delete(target); }
  disconnect() { this.observed.clear(); }
};
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; observers.mutation.push(this); }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() {}
};

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { skipOffscreenRows } = await jiti.import("./useSkipOffscreenRows.ts");
const { setFontWeight } = await jiti.import("./useFontPreferences.ts");

function transcript() {
  observers.intersection.clear();
  observers.resize.length = 0;
  observers.mutation.length = 0;
  const scroller = new FakeElement({ overflowY: "auto" });
  const rows = new FakeElement();
  scroller.append(rows);
  const first = new FakeElement({ height: 82.796875 });
  const text = new FakeNode();
  first.append(text);
  const second = new FakeElement({ height: 40 });
  rows.append(first);
  rows.append(second);
  const cleanup = skipOffscreenRows(rows);
  const near = observers.intersection.get("100% 0px");
  const far = observers.intersection.get("125% 0px");
  const rowsMutation = observers.mutation.find((observer) => observer.target === rows);
  // The observer that reports the layout of rows laid out again.
  const settled = () => observers.resize.find((observer) => observer.observed.has(first) || observer.observed.has(second));
  const report = (observer, targets, isIntersecting) => observer.callback(targets.map((target) => ({ target, isIntersecting })));
  const layoutFrame = () => { const observer = settled(); observer?.callback([...observer.observed].map((target) => ({ target }))); };
  return { rows, first, second, text, cleanup, near, far, rowsMutation, report, layoutFrame, settled };
}

test("rows are skipped past the far band and laid out inside the near one; in between nothing flips", () => {
  const { first, near, far, report, cleanup } = transcript();
  assert.ok(near.observed.has(first) && far.observed.has(first));

  report(near, [first], false);
  assert.equal(first.style.contentVisibility, undefined, "leaving the near band alone does not skip a row");
  report(far, [first], false);
  assert.equal(first.style.contentVisibility, "auto");
  assert.equal(first.style.containIntrinsicBlockSize, "82.796875px", "the size alone, no `auto` and no containment");
  assert.equal(first.style.contain, undefined);

  report(far, [first], true);
  assert.equal(first.style.contentVisibility, "auto", "entering the far band alone does not lay a row out");
  report(near, [first], true);
  assert.equal(first.style.contentVisibility, undefined);
  assert.equal(first.style.containIntrinsicBlockSize, undefined);

  cleanup();
  assert.equal(fontListeners.size, 0);
});

test("a skipped row whose content changes is laid out again and skipped once its layout is reported", () => {
  const { first, second, text, far, rowsMutation, report, layoutFrame } = transcript();
  report(far, [first, second], false);

  first.height = 120;
  rowsMutation.callback([{ type: "attributes", attributeName: "style", target: first, addedNodes: [], removedNodes: [] }]);
  assert.equal(first.style.containIntrinsicBlockSize, "82.796875px", "a row's own style writes are not changes");

  const before = layouts;
  rowsMutation.callback([{ type: "characterData", target: text, addedNodes: [], removedNodes: [] }]);
  assert.equal(layouts, before, "nothing is measured while the change is being made");
  assert.equal(first.style.contentVisibility, undefined, "laid out with the next frame");
  assert.equal(second.style.containIntrinsicBlockSize, "40px", "an unchanged row stays skipped");

  layoutFrame();
  assert.equal(first.style.contentVisibility, "auto");
  assert.equal(first.style.containIntrinsicBlockSize, "120px");
});

test("a row laid out again that comes near meanwhile is not skipped", () => {
  const { first, text, near, far, rowsMutation, report, layoutFrame, settled } = transcript();
  report(far, [first], false);
  rowsMutation.callback([{ type: "childList", target: text, addedNodes: [], removedNodes: [] }]);
  const observer = settled();
  report(near, [first], true);
  assert.ok(!observer.observed.has(first));
  layoutFrame();
  assert.equal(first.style.contentVisibility, undefined);
});

test("a font change, and a font that finished loading, re-measure every skipped row the same way", () => {
  const { first, second, far, report, layoutFrame, cleanup } = transcript();
  report(far, [first, second], false);
  first.height = 90;
  setFontWeight("ui", 600);
  assert.equal(first.style.contentVisibility, undefined);
  assert.equal(second.style.contentVisibility, undefined);
  layoutFrame();
  assert.equal(first.style.containIntrinsicBlockSize, "90px");

  first.height = 95;
  for (const listener of fontListeners) listener();
  layoutFrame();
  assert.equal(first.style.containIntrinsicBlockSize, "95px");

  cleanup();
  setFontWeight("ui", 400);
  assert.equal(first.style.containIntrinsicBlockSize, undefined, "a detached transcript no longer listens");
});

test("rows added later are observed, and removed ones forgotten", () => {
  const { rows, first, near, far, rowsMutation, report } = transcript();
  const added = new FakeElement({ height: 10 });
  rows.append(added);
  rowsMutation.callback([{ type: "childList", target: rows, addedNodes: [added], removedNodes: [] }]);
  assert.ok(near.observed.has(added) && far.observed.has(added));

  report(far, [first], false);
  rows.childNodes = rows.childNodes.filter((node) => node !== first);
  first.parentNode = null;
  rowsMutation.callback([{ type: "childList", target: rows, addedNodes: [], removedNodes: [first] }]);
  assert.ok(!near.observed.has(first) && !far.observed.has(first));
  assert.equal(first.style.contentVisibility, undefined);
});

test("the rows' container makes its rows flow-root without outranking their own display", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@layer components \{\s*:where\(\.transcript-rows\) > :where\(\*\) \{\s*display: flow-root;/);
  const chat = readFileSync(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chat, /ref=\{attachTranscriptRows\} className="transcript-rows"/);
});
