import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const hooks = {};
mock.method(React, "useState", (initial) => hooks.useState(initial));
mock.method(React, "useEffect", (effect, deps) => hooks.useEffect(effect, deps));
after(() => mock.restoreAll());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SessionFilesPanel } = await jiti.import("./SessionFilesPanel.tsx");
const { classifySessionFile } = await jiti.import("../lib/session-written-files.ts");

// Exercise the actual public component, its effects and delegated file-open action.
function mountPanel(props) {
  const state = []; const dependencies = []; let cursor = 0; let effectCursor = 0; let pending = [];
  hooks.useState = (initial) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (next) => { state[index] = next; }];
  };
  hooks.useEffect = (effect, deps) => {
    const index = effectCursor++;
    if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) pending.push(effect);
    dependencies[index] = deps;
  };
  const render = () => { cursor = 0; effectCursor = 0; return SessionFilesPanel(props); };
  return { render, async load() { render(); for (const effect of pending) effect(); pending = []; await new Promise(resolve => setImmediate(resolve)); return render(); } };
}
function buttons(tree, className) {
  if (!tree || typeof tree !== "object") return [];
  const own = tree.type === "button" && tree.props.className === className ? [tree] : [];
  return own.concat(React.Children.toArray(tree.props?.children).flatMap(child => buttons(child, className)));
}
const translate = (key, params) => params ? `${key}:${JSON.stringify(params)}` : key;
const file = (filePath, sessionWrittenAtMs = 1_000) => ({ filePath, kind: classifySessionFile(filePath), writeCount: 2, sessionWrittenAtMs });

test("session files show write facts and delegate every open without probing or displaying disk state", async t => {
  const requests = []; t.mock.method(globalThis, "fetch", async url => { requests.push(url); return { ok: true, json: async () => ({ entries: [] }) }; });
  const files = [file("/repo/a.html"), file("/repo/gone.htm"), file("/outside/referenced.md", undefined)]; const opened = [];
  const panel = mountPanel({ files, cwd: "/repo", locale: "en", translate, onOpenFile: value => opened.push(value) });
  const tree = await panel.load(); const rows = buttons(tree, "row");
  assert.equal(rows.length, 3);
  for (const row of rows) { assert.notEqual(row.props["aria-disabled"], true); row.props.onClick(); }
  assert.deepEqual(opened, files.map(entry => entry.filePath));
  assert.deepEqual(requests, [], "opening/listing does not request disk metadata");
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /sessionFiles\.(?:diskTime|diskLate|missing|unavailable)/);
  assert.match(html, /sessionFiles\.sessionTime:/); assert.match(html, /sessionFiles\.writes:/);
  assert.deepEqual(buttons(tree, "filter")[0].props.children, ["sessionFiles.filter.all", " ", 3]);
});

test("type filter memory and current session rows remain usable without a disk lookup", async t => {
  const stored = new Map([["pi-session-files-filter", "html"]]); const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else delete globalThis.window; });
  let requests = 0; t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("no disk service"); });
  const props = { files: [file("/repo/a.html"), file("/repo/b.htm"), file("/repo/c.ts")], locale: "en", translate, onOpenFile() {} };
  const panel = mountPanel(props); const tree = await panel.load(); assert.equal(buttons(tree, "row").length, 2);
  buttons(tree, "filter")[0].props.onClick(); assert.equal(stored.get("pi-session-files-filter"), "all"); assert.equal(buttons(panel.render(), "row").length, 3);
  props.files = [file("/other/new.md")]; const changed = panel.render(); assert.equal(buttons(changed, "row").length, 1); assert.match(renderToStaticMarkup(changed), /new\.md/); assert.doesNotMatch(renderToStaticMarkup(changed), /a\.html/); assert.equal(requests, 0);
});

test("a localStorage getter SecurityError does not prevent rendering or in-memory filtering", t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"); let acquisitions = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { acquisitions++; throw new DOMException("Storage access denied", "SecurityError"); } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else delete globalThis.window; });
  const panel = mountPanel({ files: [file("/repo/a.html"), file("/repo/b.htm"), file("/repo/c.ts")], locale: "en", translate, onOpenFile() {} });
  const initial = panel.render(); assert.equal(buttons(initial, "row").length, 3); buttons(initial, "filter")[2].props.onClick();
  const filtered = panel.render(); assert.equal(buttons(filtered, "row").length, 2); assert.equal(buttons(filtered, "filter")[2].props["aria-pressed"], true); assert.equal(buttons(panel.render(), "row").length, 2);
  buttons(filtered, "filter")[0].props.onClick(); assert.equal(buttons(panel.render(), "row").length, 3); assert.ok(acquisitions > 0);
});

test("an incomplete baseline displays retry instead of ordinary file totals", () => {
  let retries = 0;
  const panel = mountPanel({ files: [file("/repo/partial.html")], locale: "en", translate, onOpenFile() {}, onRetry: () => { retries++; } });
  const tree = panel.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /sessionFiles\.loadError/);
  assert.equal(buttons(tree, "row").length, 0);
  assert.equal(buttons(tree, "filter").length, 0);
  const retry = buttons(tree, "retry")[0];
  assert.equal(retry.props.children, "sessionFiles.retry");
  retry.props.onClick();
  assert.equal(retries, 1);
});
