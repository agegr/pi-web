import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

// The layout half of #1808 needs a browser (the headless repro in the commit
// message): a row whose child's margin collapsed through its edge grew by that
// margin when skipped, flipped back at the near band's edge every frame, and
// moved the rows below where that margin had collapsed with a neighbour's.
// This checks the bookkeeping around it with a stand-in DOM: block rows become
// flow-root before they are observed, a skip writes the measured size and no
// containment of its own, and a skipped row whose content changes is measured
// again while its own style writes are not taken for changes.

class FakeStyle {
  removeProperty(name) {
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

class FakeElement extends FakeNode {
  constructor({ display = "block", overflowY = "visible", height = 0 } = {}) {
    super();
    this.style = new FakeStyle();
    this.computed = { display, overflowY };
    this.height = height;
  }
  get children() { return this.childNodes.filter((node) => node instanceof FakeElement); }
  getBoundingClientRect() { return { height: this.height, width: 800 }; }
}

globalThis.HTMLElement = FakeElement;
globalThis.CSS = { supports: () => true };
globalThis.getComputedStyle = (element) => ({
  display: element.style.display ?? element.computed.display,
  overflowY: element.computed.overflowY,
  paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px",
});
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; this.observed = []; globalThis.IntersectionObserver.last = this; }
  observe(target) { this.observed.push(target); }
  unobserve(target) { this.observed = this.observed.filter((node) => node !== target); }
  disconnect() { this.observed = []; }
};
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; globalThis.MutationObserver.last = this; }
  observe(target, options) { this.options = options; }
  disconnect() {}
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const jiti = createJiti(import.meta.url);
const { skipOffscreenRows } = await jiti.import("./useSkipOffscreenRows.ts");

function transcript() {
  const scroller = new FakeElement({ overflowY: "auto" });
  const rows = new FakeElement();
  scroller.append(rows);
  const block = new FakeElement({ height: 82.796875 });
  const text = new FakeNode();
  block.append(text);
  const flex = new FakeElement({ display: "flex", height: 40 });
  rows.append(block);
  rows.append(flex);
  return { rows, block, text, flex };
}

// The observers of the rows attached last.
const observers = {
  get intersection() { return globalThis.IntersectionObserver.last; },
  get mutation() { return globalThis.MutationObserver.last; },
};
const far = (...targets) => observers.intersection.callback(targets.map((target) => ({ target, isIntersecting: false })));
const near = (...targets) => observers.intersection.callback(targets.map((target) => ({ target, isIntersecting: true })));

test("block rows hold their margins before they are observed; flex rows are left alone", () => {
  const { rows, block, flex } = transcript();
  const cleanup = skipOffscreenRows(rows);
  assert.equal(block.style.display, "flow-root");
  assert.equal(flex.style.display, undefined);
  assert.deepEqual(observers.intersection.observed, [block, flex]);
  assert.deepEqual(observers.mutation.options, { childList: true, subtree: true, characterData: true, attributes: true });

  cleanup();
  assert.equal(block.style.display, undefined, "cleanup gives the rows back as they were");
});

test("a far row keeps the size it has laid out, with no containment or remembered size of its own", () => {
  const { rows, block } = transcript();
  skipOffscreenRows(rows);
  far(block);
  assert.equal(block.style.contentVisibility, "auto");
  assert.equal(block.style.containIntrinsicBlockSize, "82.796875px");
  assert.equal(block.style.contain, undefined);

  near(block);
  assert.equal(block.style.contentVisibility, undefined);
  assert.equal(block.style.containIntrinsicBlockSize, undefined);
  assert.equal(block.style.display, "flow-root", "a near row stays a formatting context of its own");
});

test("a skipped row whose content changes is measured again; its own style writes are not changes", () => {
  const { rows, block, text, flex } = transcript();
  skipOffscreenRows(rows);
  far(block, flex);

  block.height = 120;
  observers.mutation.callback([{ type: "attributes", attributeName: "style", target: block, addedNodes: [], removedNodes: [] }]);
  assert.equal(block.style.containIntrinsicBlockSize, "82.796875px");

  observers.mutation.callback([{ type: "characterData", target: text, addedNodes: [], removedNodes: [] }]);
  assert.equal(block.style.containIntrinsicBlockSize, "120px");
  assert.equal(block.style.contentVisibility, "auto");
  assert.equal(flex.style.containIntrinsicBlockSize, "40px", "an unchanged row is not measured again");
});

test("rows added later are adopted the same way, and removed ones forgotten", () => {
  const { rows, block } = transcript();
  skipOffscreenRows(rows);
  const added = new FakeElement({ height: 10 });
  rows.append(added);
  observers.mutation.callback([{ type: "childList", target: rows, addedNodes: [added], removedNodes: [] }]);
  assert.equal(added.style.display, "flow-root");
  assert.ok(observers.intersection.observed.includes(added));

  far(block);
  rows.childNodes = rows.childNodes.filter((node) => node !== block);
  block.parentNode = null;
  observers.mutation.callback([{ type: "childList", target: rows, addedNodes: [], removedNodes: [block] }]);
  assert.ok(!observers.intersection.observed.includes(block));
  assert.equal(block.style.contentVisibility, undefined);
});
