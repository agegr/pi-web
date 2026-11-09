import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { fileVersion, fileVersionChanged } from "../lib/file-version.ts";

// Exercise the actual recovery hook with effects and network completions under
// test control, without importing the viewer's Markdown/Prism dependencies.
const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useFilePreviewRecovery");
const { outputText } = ts.transpileModule(`${hook.getText(ast)}\nreturn useFilePreviewRecovery;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
function harness(initial = "4:old") {
  let shown = initial;
  const loads = [], requests = [], effects = [];
  let check;
  const fetch = (url, init) => new Promise(resolve => requests.push({ url, init, resolve }));
  const recovery = new Function("useRef", "useEffect", "fetch", "getFileApiUrl", "onFilePreviewRefresh", "fileVersion", "fileVersionChanged", outputText)(
    value => ({ current: value }), fn => effects.push(fn), fetch,
    (path, type, session) => `${path}:${type}:${session}`,
    (path, callback) => { check = callback; return () => { check = null; }; }, fileVersion, fileVersionChanged,
  );
  recovery("/report.md", "session", true, () => shown, (version, meta) => { shown = version; loads.push(meta); });
  const cleanup = effects.map(fn => fn()).filter(Boolean);
  return {
    loads, requests, check: () => check(), setShown: value => { shown = value; },
    cleanup: () => cleanup.forEach(fn => fn()),
    answer: async (index, meta) => { requests[index].resolve({ json: async () => meta }); await new Promise(setImmediate); },
  };
}

test("unchanged focus/reopen keeps the preview; a same-size edit reloads", async () => {
  const h = harness();
  await h.answer(0, { size: 4, mtime: "old" });
  assert.equal(h.loads.length, 0);
  h.check();
  await h.answer(1, { size: 4, mtime: "new" });
  assert.equal(h.loads.length, 1);
  h.check();
  await h.answer(2, { size: 4, mtime: "new" });
  assert.equal(h.loads.length, 1);
  h.cleanup();
});

test("newer checks, watch changes and unmount invalidate pending answers", async () => {
  const h = harness();
  h.check();
  assert.equal(h.requests[0].init.signal.aborted, true);
  await h.answer(0, { size: 4, mtime: "stale" });
  assert.equal(h.loads.length, 0);
  h.setShown("4:watch");
  await h.answer(1, { size: 4, mtime: "older-than-watch" });
  assert.equal(h.loads.length, 0);
  h.check();
  h.cleanup();
  assert.equal(h.requests[2].init.signal.aborted, true);
  await h.answer(2, { size: 4, mtime: "after-unmount" });
  assert.equal(h.loads.length, 0);
});

test("a file refusal reaches the existing viewer's error handling", async () => {
  const h = harness();
  await h.answer(0, { error: "Access denied" });
  assert.deepEqual(h.loads, [{ error: "Access denied" }]);
  h.cleanup();
});
