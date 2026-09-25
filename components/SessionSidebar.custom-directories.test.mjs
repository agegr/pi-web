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
  // The dialog receives the entries list and the outcome-returning
  // rename/delete callbacks (wi pi#52).
  assert.match(source, /entries=\{/);
  assert.match(source, /onRenameEntryPath=/);
  assert.match(source, /onRemoveEntry=/);
});

test("the manage rows run through the guarded seams, not raw store calls (wi pi#52)", () => {
  // The picker's delete composes createRowDeleteHandler (last-entry guard +
  // removal + expansion-key discard) and rename composes
  // createRowPathRenameHandler (the store's path-edit primitive).
  assert.match(source, /createRowDeleteHandler\(\{/);
  assert.match(source, /createRowPathRenameHandler\(\{/);
  assert.match(source, /renameCustomDirectoryPath/);
  assert.match(source, /discardExpandedGroupKey/);
  // The refusal reasons surface in-dialog through the picker's own i18n keys.
  assert.match(source, /directoryPicker\.cannotRemoveLastEntry/);
  assert.match(source, /directoryPicker\.renamePathRequired/);
  assert.match(source, /directoryPicker\.renamePathDuplicate/);
  // The seams are wired ONLY into the add-directory manage picker, exactly
  // like the pin callback: the plain customPath picker stays untouched.
  assert.equal((source.match(/onRenameEntryPath=/g) ?? []).length, 1);
  assert.equal((source.match(/onRemoveEntry=/g) ?? []).length, 1);
  const customPathPickerStart = source.indexOf("{customPathOpen && (");
  const addDirectoryPickerStart = source.indexOf("{addDirectoryOpen && (");
  const managePickerEnd = source.indexOf("onCancel={() => setAddDirectoryOpen(false)}");
  assert.ok(customPathPickerStart !== -1 && addDirectoryPickerStart !== -1);
  assert.ok(
    source.slice(customPathPickerStart, addDirectoryPickerStart).indexOf("onRemoveEntry") === -1
      && source.slice(customPathPickerStart, addDirectoryPickerStart).indexOf("onRenameEntryPath") === -1,
    "the plain customPath picker must not receive the manage callbacks",
  );
  for (const marker of ["onRenameEntryPath=", "onRemoveEntry="]) {
    const at = source.indexOf(marker);
    assert.ok(at > addDirectoryPickerStart && at < managePickerEnd, `${marker} sits inside the manage picker's props`);
  }
});

test("a successful rename keeps the renamed group expanded under its new identity", () => {
  // The re-expand rule: only when the OLD identity was the expanded group.
  // A rename handler body that unconditionally expands would collapse the
  // accordion onto the renamed group even when another group was open.
  const renamePropAt = source.indexOf("onRenameEntryPath={");
  const reExpandAt = source.indexOf("expandPinnedGroup(customDirectoryIdentity(nextPath.trim()))");
  assert.ok(renamePropAt !== -1 && reExpandAt > renamePropAt, "the rename callback re-expands under the new identity");
  const guardAt = source.indexOf("expandedGroupKeys.has(oldKey)");
  assert.ok(guardAt > renamePropAt && guardAt < reExpandAt, "the re-expand is guarded on the old key being expanded");
});

test("the Add button moved into the top toolbar row, level with refresh and search (wi pi#52)", () => {
  // Exactly ONE Add trigger remains, and it lives in the toolbar row after
  // the refresh and search buttons — not as a standalone full-width button.
  assert.equal((source.match(/setAddDirectoryOpen\(true\)/g) ?? []).length, 1);
  const refreshAt = source.indexOf('title={t("sidebar.refresh")}');
  const searchAt = source.indexOf('title={t("sidebar.toggleSessionSearch")}');
  const addAt = source.indexOf('onClick={() => setAddDirectoryOpen(true)}');
  assert.ok(refreshAt !== -1 && searchAt !== -1 && addAt !== -1);
  assert.ok(refreshAt < searchAt && searchAt < addAt, "Add sits in the same row, after refresh and search");
  // The Add button keeps its label and gains the toolbar's 32px icon-button
  // styling; the old full-width standalone button is gone entirely.
  const addButtonSlice = source.slice(addAt, addAt + 700);
  assert.match(addButtonSlice, /sidebar\.addNew/);
  assert.match(addButtonSlice, /h-\[32px\] w-\[32px\]/);
  assert.doesNotMatch(source, /h-\[30px\] w-full/, "no standalone full-width Add button remains");
  // No duplicate button is left behind: the label appears in the button
  // title/aria only, not as a separate rendered text span.
  assert.doesNotMatch(source, /\{t\("sidebar\.addNew"\)\}<\/span>/);
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
