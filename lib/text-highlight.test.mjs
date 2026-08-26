import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { locateOffset, planHighlightRanges, supportsTextHighlight, clearTextHighlight, applyTextHighlight } =
  await jiti.import("./text-highlight.ts");
const { buildMatcher } = await jiti.import("./text-match.ts");

// Text nodes of "foo" + "bar" + "baz" concatenated as one 9-char string.
const spans = [
  { start: 0, end: 3 },
  { start: 3, end: 6 },
  { start: 6, end: 9 },
];

test("locateOffset resolves node boundaries differently for starts and ends", () => {
  assert.deepEqual(locateOffset(spans, 0), { index: 0, offset: 0 });
  // A start offset at a boundary belongs to the node that begins there...
  assert.deepEqual(locateOffset(spans, 3), { index: 1, offset: 0 });
  // ...while an end offset belongs to the node that ends there.
  assert.deepEqual(locateOffset(spans, 3, true), { index: 0, offset: 3 });
  assert.deepEqual(locateOffset(spans, 9, true), { index: 2, offset: 3 });
  assert.equal(locateOffset(spans, 9), null);
  assert.equal(locateOffset(spans, 20, true), null);
  assert.equal(locateOffset([], 0), null);
});

test("plans a range inside one text node", () => {
  assert.deepEqual(planHighlightRanges(spans, [{ start: 4, end: 6 }]), [
    { startIndex: 1, startOffset: 1, endIndex: 1, endOffset: 3 },
  ]);
});

test("plans a range that spans several text nodes (inline markup, code spans)", () => {
  assert.deepEqual(planHighlightRanges(spans, [{ start: 2, end: 7 }]), [
    { startIndex: 0, startOffset: 2, endIndex: 2, endOffset: 1 },
  ]);
});

test("drops empty and unmappable matches instead of throwing", () => {
  assert.deepEqual(planHighlightRanges(spans, [{ start: 5, end: 5 }]), []);
  assert.deepEqual(planHighlightRanges(spans, [{ start: 8, end: 30 }]), []);
  assert.deepEqual(planHighlightRanges([], [{ start: 0, end: 2 }]), []);
});

test("plans every match of a multi-occurrence query in order", () => {
  const text = "needle and needle";
  const nodeSpans = [{ start: 0, end: text.length }];
  const matcher = buildMatcher("needle", "substring", false);
  const plans = planHighlightRanges(nodeSpans, matcher.find(text, 10));
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0], { startIndex: 0, startOffset: 0, endIndex: 0, endOffset: 6 });
  assert.deepEqual(plans[1], { startIndex: 0, startOffset: 11, endIndex: 0, endOffset: 17 });
});

test("degrades to no highlight when the browser lacks the Highlight API", () => {
  // Node has neither CSS nor Highlight, which is exactly the unsupported case.
  assert.equal(supportsTextHighlight(), false);
  assert.doesNotThrow(() => clearTextHighlight());
  assert.deepEqual(applyTextHighlight({}, buildMatcher("x", "substring", false)), []);
});

test("the client-side matching modules stay free of server-only imports", async () => {
  // The chat bundle imports these; lib/session-search.ts pulls in node:fs
  // through session-reader and must never be reachable from the browser.
  for (const file of ["./text-match.ts", "./text-highlight.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "node:/, `${file} must not import node builtins`);
    assert.doesNotMatch(source, /session-reader|session-search/, `${file} must stay client-safe`);
  }
});

// --- End-to-end against a stub DOM ---------------------------------------
// Node has no DOM and the repo has no jsdom, but the interesting logic is which
// text nodes and offsets end up in the ranges, which a small stub can prove.

function stubDom(chunks) {
  const nodes = chunks.map((data) => ({ data }));
  const created = [];
  const registry = new Map();
  const injected = [];
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    getElementById: (id) => injected.find((style) => style.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (style) => injected.push(style) },
    createTreeWalker() {
      let index = -1;
      return {
        nextNode() {
          index += 1;
          return index < nodes.length ? nodes[index] : null;
        },
      };
    },
    createRange() {
      const range = {
        setStart(node, offset) { range.start = [nodes.indexOf(node), offset]; },
        setEnd(node, offset) { range.end = [nodes.indexOf(node), offset]; },
      };
      created.push(range);
      return range;
    },
  };
  globalThis.CSS = { highlights: registry };
  globalThis.Highlight = class {
    constructor(...ranges) { this.ranges = ranges; }
  };
  return { registry, created, injected };
}

function restoreDom() {
  delete globalThis.NodeFilter;
  delete globalThis.document;
  delete globalThis.CSS;
  delete globalThis.Highlight;
}

test("registers one range per match, across text-node boundaries", (t) => {
  t.after(restoreDom);
  const { registry, injected } = stubDom(["the fresh", "ness check and fresh", "ness again"]);
  const ranges = applyTextHighlight({}, buildMatcher("freshness", "substring", false));

  assert.equal(ranges.length, 2, "both occurrences highlight, even when split across nodes");
  // "fresh|ness": starts at offset 4 of node 0, ends at offset 4 of node 1.
  assert.deepEqual(ranges[0].start, [0, 4]);
  assert.deepEqual(ranges[0].end, [1, 4]);
  assert.deepEqual(ranges[1].start, [1, 15]);
  assert.deepEqual(ranges[1].end, [2, 4]);
  assert.equal(registry.get("pi-chat-search").ranges.length, 2);
  // The ::highlight() rule ships from here, once, because the build CSS parser
  // rejects the pseudo-element.
  assert.equal(injected.length, 1);
  assert.match(injected[0].textContent, /::highlight\(pi-chat-search\)/);
  // Self-contained: no CSS variables, explicit foreground, dark-theme variant.
  assert.doesNotMatch(injected[0].textContent, /var\(--/);
  assert.match(injected[0].textContent, /color: #111827/);
  assert.match(injected[0].textContent, /html\.dark ::highlight\(pi-chat-search\)/);
  injected[0].textContent = "stale";
  applyTextHighlight({}, buildMatcher("freshness", "substring", false));
  assert.equal(injected.length, 1, "the style tag is appended only once");
  assert.match(injected[0].textContent, /::highlight\(pi-chat-search\)/,
    "a stale rule from an earlier build is rewritten, not kept");
});

test("clears the registry instead of leaving a stale highlight when nothing matches", (t) => {
  t.after(restoreDom);
  const { registry } = stubDom(["nothing to see"]);
  registry.set("pi-chat-search", "stale");
  assert.deepEqual(applyTextHighlight({}, buildMatcher("freshness", "substring", false)), []);
  assert.equal(registry.has("pi-chat-search"), false);
});

test("empty subtrees clear the highlight and report no ranges", (t) => {
  t.after(restoreDom);
  const { registry } = stubDom([]);
  registry.set("pi-chat-search", "stale");
  assert.deepEqual(applyTextHighlight({}, buildMatcher("x", "substring", false)), []);
  assert.equal(registry.has("pi-chat-search"), false);
});
