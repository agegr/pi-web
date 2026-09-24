import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../lib/custom-directories.ts", import.meta.url), "utf8");
const pinFlowSource = await readFile(new URL("../lib/custom-directory-pin.ts", import.meta.url), "utf8");

test("the sidebar renders the user's custom directory list (not the legacy pin store)", () => {
  assert.match(source, /listCustomDirectories\(\)/);
  assert.match(source, /customDirectoryIdentity\(entry\.path\)/);
  // The legacy pin store reader is gone from the sidebar entirely.
  assert.doesNotMatch(source, /getPinnedProjects\(\)/);
});

test("the directory entry manages rename and remove through the custom-directories store", () => {
  assert.match(source, /renameCustomDirectory/);
  assert.match(source, /removeCustomDirectory/);
  // The store's rename/remove persist through the same writer.
  assert.match(storeSource, /export function renameCustomDirectory/);
  assert.match(storeSource, /export function removeCustomDirectory/);
});

test("the manage affordances open the picker dialog in manage mode (entries passed)", () => {
  // The dialog receives the entries list and the rename/remove callbacks.
  assert.match(source, /entries=\{/);
  assert.match(source, /onRenameEntry=/);
  assert.match(source, /onRemoveEntry=/);
});

// ---------------------------------------------------------------------------
// wi pi#47: the picker's per-row pin flow. Behavioral coverage drives
// createDirectoryPinFlow with a fake fetch and the REAL custom-directories
// store (backed by an in-memory storage): validate-then-add, idempotent
// head-of-list, and the typed no-mutation failure contract.
// ---------------------------------------------------------------------------
import { createJiti } from "jiti";

const flowJiti = createJiti(import.meta.url, { tsconfigPaths: true, interopDefault: true });
const { createDirectoryPinFlow } = await flowJiti.import("../lib/custom-directory-pin.ts");
const {
  addCustomDirectory,
  listCustomDirectories,
  CUSTOM_DIRECTORIES_STORAGE_KEY,
} = await flowJiti.import("../lib/custom-directories.ts");

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

function okValidate() {
  return new Response(JSON.stringify({ success: true, cwd: "/work/project" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("a successful pin validates first, then mutates the store and notifies the owner", async () => {
  const storage = memoryStorage();
  const calls = [];
  const added = [];
  const pin = createDirectoryPinFlow({
    fetchFn: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return okValidate();
    },
    add: (path) => addCustomDirectory(path, storage),
    onAdded: (path) => added.push(path),
  });

  const outcome = await pin("/work/project");
  assert.deepEqual(outcome, { ok: true });
  // The validate registration ran exactly once, on the picked directory.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/cwd/validate");
  assert.deepEqual(calls[0].body, { cwd: "/work/project" });
  // The store mutation and owner notification both happened.
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/work/project"]);
  assert.deepEqual(added, ["/work/project"]);
});

test("re-pinning an already-listed directory keeps exactly one entry, moved to head", async () => {
  const storage = memoryStorage();
  addCustomDirectory("/work/first", storage);
  addCustomDirectory("/work/project", storage);
  assert.deepEqual(
    listCustomDirectories(storage).map((entry) => entry.path),
    ["/work/project", "/work/first"],
  );

  const pin = createDirectoryPinFlow({
    fetchFn: async () => okValidate(),
    add: (path) => addCustomDirectory(path, storage),
  });
  assert.deepEqual(await pin("/work/first"), { ok: true });
  const entries = listCustomDirectories(storage);
  assert.equal(entries.length, 2, "no duplicate entry is created");
  assert.deepEqual(entries.map((entry) => entry.path), ["/work/first", "/work/project"]);
});

test("a failed validation returns the typed error with ZERO store mutation", async () => {
  const storage = memoryStorage();
  const added = [];
  const pin = createDirectoryPinFlow({
    fetchFn: async () => new Response(JSON.stringify({ error: "Directory does not exist" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
    add: (path) => addCustomDirectory(path, storage),
    onAdded: (path) => added.push(path),
  });

  const outcome = await pin("/work/missing");
  assert.deepEqual(outcome, { ok: false, error: "Directory does not exist" });
  // Nothing was written: the store key is untouched and no success was reported.
  assert.equal(storage.getItem(CUSTOM_DIRECTORIES_STORAGE_KEY), null);
  assert.deepEqual(added, []);
});

test("a network failure during validation is a typed error, never a crash", async () => {
  const pin = createDirectoryPinFlow({
    fetchFn: async () => { throw new Error("connection refused"); },
    add: () => { throw new Error("store must not be touched"); },
  });
  assert.deepEqual(await pin("/work/anywhere"), { ok: false, error: "connection refused" });
});

test("SessionSidebar owns the pin flow and wires it ONLY into the add-directory manage picker", () => {
  // The flow is constructed in the sidebar (the store owner)…
  assert.match(source, /createDirectoryPinFlow\(\{/);
  // …and the store write is INJECTED by the sidebar: the flow helper carries
  // no production default mutation (review blocker, pi#47).
  assert.match(source, /add: \(path: string\) => addCustomDirectory\(path\)/);
  assert.doesNotMatch(pinFlowSource, /add \?\?/, "the flow helper must not default the store mutation");
  assert.doesNotMatch(pinFlowSource, /addCustomDirectory/, "the flow helper must not import the store writer");
  assert.match(source, /onPinDirectory=\{pinDirectory\}/);
  // The plain customPath picker stays select-and-close: onPinDirectory is
  // passed exactly once, inside the addDirectoryOpen picker block.
  assert.equal((source.match(/onPinDirectory=/g) ?? []).length, 1);
  const customPathPickerStart = source.indexOf("{customPathOpen && (");
  const addDirectoryPickerStart = source.indexOf("{addDirectoryOpen && (");
  const pinPropAt = source.indexOf("onPinDirectory={pinDirectory}");
  assert.ok(customPathPickerStart !== -1 && addDirectoryPickerStart !== -1);
  assert.ok(pinPropAt > addDirectoryPickerStart, "the pin callback belongs to the manage picker");
  assert.ok(
    pinPropAt < source.indexOf("onCancel={() => setAddDirectoryOpen(false)}"),
    "the pin callback sits inside the manage picker's props",
  );
  assert.ok(
    source.slice(customPathPickerStart, addDirectoryPickerStart).indexOf("onPinDirectory") === -1,
    "the plain customPath picker must not receive the pin callback",
  );
});

// ---------------------------------------------------------------------------
// The sidebar's REAL pin-success notification, executed (not regex-matched):
// the production onAdded body from SessionSidebar.tsx is extracted via the
// TypeScript AST, transpiled and run against controlled stubs — proving the
// revision bump, the group expansion with the store's real identity key, and
// the scroll-to-top, exactly as a successful pin triggers them in the app.
// ---------------------------------------------------------------------------
import ts from "typescript";
import { Script } from "node:vm";

const tsJiti = createJiti(import.meta.url, { tsconfigPaths: true, interopDefault: true });
const { customDirectoryIdentity } = await tsJiti.import("../lib/custom-directories.ts");

function findOnAddedBody(node, sourceFile) {
  if (
    ts.isPropertyAssignment(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "onAdded"
  ) {
    return node.initializer;
  }
  return ts.forEachChild(node, (child) => findOnAddedBody(child, sourceFile));
}

test("a successful pin fires the sidebar's REAL notification: revision bump, group expansion, scroll-to-top", () => {
  const sourceFile = ts.createSourceFile(
    "SessionSidebar.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const onAdded = findOnAddedBody(sourceFile, sourceFile);
  assert.ok(onAdded, "the sidebar's pin flow carries an onAdded notification");

  const script = new Script(ts.transpileModule(onAdded.getText(sourceFile), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);

  // Controlled production collaborators: the state setter, the accordion
  // expander and the list scroller, all observed.
  let revision = 7;
  const revisions = [];
  const expanded = [];
  const scrolled = [];
  const runOnAdded = script.runInNewContext({
    setPinnedRevision: (updater) => {
      const next = updater(revision);
      revisions.push(next);
      revision = next;
    },
    expandPinnedGroup: (identity) => expanded.push(identity),
    listScrollRef: { current: { scrollTo: (options) => scrolled.push(options) } },
    customDirectoryIdentity,
  });
  assert.equal(typeof runOnAdded, "function");
  runOnAdded("/work/pinned-project");

  assert.deepEqual(revisions, [8], "the pinned-revision notification bumps exactly once");
  assert.deepEqual(expanded, [customDirectoryIdentity("/work/pinned-project")], "the new directory's group expands under its real identity key");
  assert.equal(scrolled.length, 1, "the list scrolls exactly once");
  assert.equal(scrolled[0].top, 0, "the list scrolls to the top so the new group is visible");
});
