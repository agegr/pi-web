import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const { captureScrollDistance, getNextVisibleCount } = await import("../lib/chat-lazy-load.ts");

const source = ts.createSourceFile("ChatWindow.tsx", await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
const effect = nodes.find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[0].getText(source).includes("new IntersectionObserver"));
assert.ok(effect, "missing the sentinel observer effect");
const [body, deps] = effect.arguments;
const script = new Script(ts.transpileModule(`(${body.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);

// Runs the effect with the given history state and reports what the sentinel
// coming into view does.
function reachTop({ hasEarlierMessages }) {
  const calls = { visibleCount: 50, loads: [] };
  let observed = null;
  const context = createContext({
    sentinel: {}, scrollContainerRef: { current: { scrollHeight: 4000, scrollTop: 0 } },
    loadingOlderRef: { current: false }, prevScrollDistanceRef: { current: null },
    hasEarlierMessages, historyCursor: "older", session: { id: "a" }, sessionIdRef: { current: "a" }, activeLeafId: "leaf",
    captureScrollDistance, getNextVisibleCount,
    setVisibleCount: (update) => { calls.visibleCount = update(calls.visibleCount); },
    loadContext: (...args) => { calls.loads.push(args); return Promise.resolve(); },
    IntersectionObserver: class { constructor(callback) { observed = callback; } observe() {} disconnect() {} },
  });
  script.runInContext(context)();
  observed([{ isIntersecting: true }]);
  return { ...calls, scrollDistance: context.prevScrollDistanceRef.current };
}

test("with every message loaded, reaching the top widens the window over rows still hidden", () => {
  assert.deepEqual(reachTop({ hasEarlierMessages: false }), { visibleCount: 100, loads: [], scrollDistance: 4000 });
});

test("with older history on the server, reaching the top fetches the previous page", () => {
  const { visibleCount, loads } = reachTop({ hasEarlierMessages: true });
  assert.equal(visibleCount, 50);
  assert.deepEqual(loads.map((args) => [...args]), [["a", "leaf", "older"]]);
});

test("the observer is renewed when the sentinel mounts or the window grows", () => {
  const names = deps.elements.map((element) => element.getText(source));
  assert.ok(names.includes("sentinel"), "a sentinel that appears later needs an observer");
  assert.ok(names.includes("visibleCount"), "a sentinel still in view after the window grew needs a new observation");
  assert.match(source.getFullText(), /<div ref=\{setSentinel\}/);
});
