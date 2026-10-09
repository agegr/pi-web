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
const hook = (name, includes) => nodes.find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === name
  && node.arguments[0].getText(source).includes(includes));
const compile = (node) => new Script(ts.transpileModule(`(${node.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
const effect = hook("useEffect", "new IntersectionObserver");
assert.ok(effect, "missing the sentinel observer effect");
const [body, deps] = effect.arguments;
const script = compile(body);
const loadOlderPage = compile(hook("useCallback", "requestedCursorRef.current = before").arguments[0]);
const forgetCursor = compile(hook("useEffect", "requestedCursorRef.current = null").arguments[0]);

// Mounts the observer effect with the given history state; `reachTop()` is the
// sentinel coming into view, `render(cursor)` the next cursor rendering.
function mount({ hasEarlierMessages, landed = true }) {
  const calls = { visibleCount: 50, loads: [] };
  let observed = null;
  const context = createContext({
    sentinel: {}, scrollContainerRef: { current: { scrollHeight: 4000, scrollTop: 0 } },
    loadingOlderRef: { current: false }, prevScrollDistanceRef: { current: null }, requestedCursorRef: { current: null },
    hasEarlierMessages, historyCursor: "older", session: { id: "a" }, sessionIdRef: { current: "a" }, activeLeafId: "leaf",
    captureScrollDistance, getNextVisibleCount,
    setVisibleCount: (update) => { calls.visibleCount = update(calls.visibleCount); },
    loadContext: (...args) => { calls.loads.push(args); return Promise.resolve(landed ? { oldestEntryId: "oldest" } : undefined); },
    IntersectionObserver: class { constructor(callback) { observed = callback; } observe() {} disconnect() {} },
  });
  context.loadOlderPage = loadOlderPage.runInContext(context);
  const run = () => script.runInContext(context)();
  run();
  return {
    calls,
    context,
    reachTop: async () => {
      observed([{ isIntersecting: true }]);
      await new Promise((resolve) => setImmediate(resolve));
    },
    render: (cursor) => {
      context.historyCursor = cursor;
      forgetCursor.runInContext(context)();
      run();
    },
  };
}

async function reachTop(state) {
  const { calls, context, reachTop: report } = mount(state);
  await report();
  return { ...calls, scrollDistance: context.prevScrollDistanceRef.current };
}

const cursors = (calls) => calls.loads.map((args) => args[2]);

test("with every message loaded, reaching the top widens the window over rows still hidden", async () => {
  assert.deepEqual(await reachTop({ hasEarlierMessages: false }), { visibleCount: 100, loads: [], scrollDistance: 4000 });
});

test("with older history on the server, reaching the top fetches the previous page", async () => {
  const { visibleCount, loads } = await reachTop({ hasEarlierMessages: true });
  assert.equal(visibleCount, 50);
  assert.deepEqual(loads.map((args) => [...args]), [["a", "leaf", "older", undefined]]);
});

test("a report before the next cursor renders does not fetch the landed page again", async () => {
  const chat = mount({ hasEarlierMessages: true });
  await chat.reachTop();
  await chat.reachTop();
  assert.deepEqual(cursors(chat.calls), ["older"]);
  chat.render("oldest");
  await chat.reachTop();
  assert.deepEqual(cursors(chat.calls), ["older", "oldest"]);
});

test("a page that did not land, or a cursor a reload brought back, is fetched again", async () => {
  const failed = mount({ hasEarlierMessages: true, landed: false });
  await failed.reachTop();
  await failed.reachTop();
  assert.deepEqual(cursors(failed.calls), ["older", "older"]);

  const reloaded = mount({ hasEarlierMessages: true });
  await reloaded.reachTop();
  reloaded.render("oldest");
  reloaded.render("older");
  await reloaded.reachTop();
  assert.deepEqual(cursors(reloaded.calls), ["older", "older"]);
});

test("the observer is renewed when the sentinel mounts or the window grows", () => {
  const names = deps.elements.map((element) => element.getText(source));
  assert.ok(names.includes("sentinel"), "a sentinel that appears later needs an observer");
  assert.ok(names.includes("visibleCount"), "a sentinel still in view after the window grew needs a new observation");
  assert.match(source.getFullText(), /<div ref=\{setSentinel\}/);
});
