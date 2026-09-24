import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  PickerCreateToolbar,
  PickerShowHiddenToggle,
  PickerBrowseRow,
  PickerDriveRow,
  PickerManagePanel,
  createRowPinHandler,
  createPickerErrorState,
  pickerErrorMessage,
  createCreateFlow,
} = await jiti.import("./DirectoryPicker.tsx");

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");
const browseEngineSource = await readFile(new URL("../lib/directory-picker-browse.ts", import.meta.url), "utf8");
const { NEW_FILE_NAME_ISSUES } = await jiti.import("../lib/directory-picker-browse.ts");

const t = (key) => key;

function html(element) {
  return renderToStaticMarkup(element);
}

test("the browse-area toolbar offers new-folder AND new-file (both modes mount it)", () => {
  const markup = html(React.createElement(PickerCreateToolbar, {
    t,
    onNewFolder: () => {},
    onNewFile: () => {},
  }));
  assert.match(markup, /directoryPicker\.newFolder/);
  assert.match(markup, /directoryPicker\.newFile/);
});

test("the show-hidden checkbox renders from its checked prop (default unchecked)", () => {
  const unchecked = html(React.createElement(PickerShowHiddenToggle, { t, checked: false, onChange: () => {} }));
  assert.match(unchecked, /type="checkbox"/);
  assert.doesNotMatch(unchecked, /checked/);
  const checked = html(React.createElement(PickerShowHiddenToggle, { t, checked: true, onChange: () => {} }));
  assert.match(checked, /checked/);
  assert.match(checked, /directoryPicker\.showHidden/);
});

test("directory rows render a sibling pin button only when the callback is present", () => {
  const entry = { name: "project", path: "/work/project" };
  const withPin = html(React.createElement(PickerBrowseRow, {
    entry,
    t,
    onNavigate: () => {},
    onPin: () => {},
  }));
  // Pin renders with the callback…
  assert.match(withPin, /directory-picker-pin/);
  assert.match(withPin, /directoryPicker\.pinDirectory/);
  // …as a SIBLING of the navigation button, never nested inside it.
  const navStart = withPin.indexOf("<button");
  const navEnd = withPin.indexOf("</button>", navStart);
  const pinStart = withPin.indexOf("directory-picker-pin");
  assert.ok(pinStart > navEnd, "the pin button must not be nested in the navigation button");

  const withoutPin = html(React.createElement(PickerBrowseRow, {
    entry,
    t,
    onNavigate: () => {},
  }));
  assert.doesNotMatch(withoutPin, /directory-picker-pin/);
  assert.equal((withoutPin.match(/<button/g) ?? []).length, 1, "no-callback rows stay single navigation buttons");
});

test("Windows drive rows never render a pin affordance", () => {
  const drive = { name: "C:", path: "C:\\" };
  const markup = html(React.createElement(PickerDriveRow, { entry: drive, onNavigate: () => {} }));
  assert.doesNotMatch(markup, /directory-picker-pin/);
  assert.equal((markup.match(/<button/g) ?? []).length, 1);
});

test("the manage panel keeps entries/rename/remove only — no creation form", () => {
  const entries = [
    { path: "/work/alpha", displayName: "Alpha" },
    { path: "/work/beta" },
  ];
  const markup = html(React.createElement(PickerManagePanel, {
    t,
    entries,
    onRename: () => {},
    onRemove: () => {},
  }));
  assert.match(markup, /directoryPicker\.entriesTitle/);
  assert.match(markup, /\/work\/alpha/);
  assert.match(markup, /\/work\/beta/);
  assert.match(markup, /directoryPicker\.renameEntry/);
  assert.match(markup, /directoryPicker\.removeEntry/);
  // The manage panel's "New folder" button and inline form are deleted.
  assert.doesNotMatch(markup, /directoryPicker\.newFolder/);
  assert.doesNotMatch(markup, /<input/);
});

test("the pin row handler invokes the callback and only the callback", async () => {
  const errors = [];
  const pinned = [];
  // Success: the callback is invoked with the row path and nothing else —
  // by construction the handler has no navigation, refetch or close inputs.
  const successHandler = createRowPinHandler({
    onPin: async (path) => { pinned.push(path); return { ok: true }; },
    onError: (message) => errors.push(message),
  });
  await successHandler("/work/project");
  assert.deepEqual(pinned, ["/work/project"]);
  assert.deepEqual(errors, []);

  // Failure: the typed error is surfaced, no success report.
  const failureHandler = createRowPinHandler({
    onPin: async () => ({ ok: false, error: "Directory does not exist" }),
    onError: (message) => errors.push(message),
  });
  await failureHandler("/work/missing");
  assert.deepEqual(errors, ["Directory does not exist"]);

  // A throwing callback is caught and surfaced, never crashing the dialog.
  const throwingHandler = createRowPinHandler({
    onPin: async () => { throw new Error("offline"); },
    onError: (message) => errors.push(message),
  });
  await throwingHandler("/work/anywhere");
  assert.deepEqual(errors, ["Directory does not exist", "offline"]);
});

test("the dialog wires the engine: persisted toggle, current-directory refetch, local validation", () => {
  // Show-hidden: initialization and toggle run through the composed
  // lifecycle seam (its composed behavior — navigate away, toggle targets
  // the current path, stale responses dropped, reopen restores — is covered
  // behaviorally in lib/directory-picker-browse.test.mjs).
  assert.match(source, /createShowHiddenLifecycle\(\{/);
  assert.match(source, /controllerRef\.current\.refetchCurrent\(\)/);
  // Storage acquisition rides inside the seam's failure-safe getter, never
  // a bare `window.localStorage` read.
  assert.doesNotMatch(source, /loadShowHiddenPreference\(window\.localStorage\)/);
  assert.doesNotMatch(source, /saveShowHiddenPreference\(window\.localStorage/);
  // Creation runs through the engine's production seam (its behavior is
  // covered behaviorally in lib/directory-picker-browse.test.mjs: unsafe
  // names issue zero requests, 207/409 are typed failures, folder success
  // enters the created folder).
  assert.match(source, /runCreateSubmission\(\{/);
  assert.match(source, /directoryPicker\.validation\.\$\{issue\}/);
  // File success confirms in-dialog via i18n.
  assert.match(source, /directoryPicker\.fileCreated/);
  // The pin callback is optional and only renders rows with pin when set.
  assert.match(source, /onPinDirectory\?: \(path: string\) => Promise<PinOutcome>/);
  // The engine itself never formats user-facing English: validation
  // returns typed codes only.
  assert.doesNotMatch(browseEngineSource, /File names must not contain a path/);
  assert.doesNotMatch(browseEngineSource, /File name is required/);
});

test("the error-lifecycle seam: stale errors never mask a fresh failure", () => {
  const state = { load: null, pin: null };
  const errors = createPickerErrorState({
    setLoadError: (message) => { state.load = message; },
    setPinError: (message) => { state.pin = message; },
  });

  // Browse failure → successful recovery clears it.
  errors.onBrowseError("HTTP 404");
  assert.equal(state.load, "HTTP 404");
  errors.onBrowseSuccess();
  assert.equal(state.load, null, "a successful browse clears the browse error");

  // A new browse request resets BOTH stale errors.
  errors.onBrowseError("old browse error");
  errors.onPinError("old pin error");
  errors.onBrowseStart();
  assert.equal(state.load, null);
  assert.equal(state.pin, null);

  // A genuine pin failure stays visible even when a browse error exists —
  // and the render precedence picks it.
  errors.onBrowseError("stale browse error");
  errors.onPinStart();
  errors.onPinError("pin failed");
  assert.equal(
    pickerErrorMessage({ pinError: state.pin, loadError: state.load, external: null }),
    "pin failed",
    "the pin failure outranks the stale browse error",
  );

  // A new pin attempt resets the previous pin error first.
  errors.onPinStart();
  assert.equal(state.pin, null);

  // With no pin error, the browse error renders; the external prop is last.
  assert.equal(pickerErrorMessage({ pinError: null, loadError: "browse", external: "ext" }), "browse");
  assert.equal(pickerErrorMessage({ pinError: null, loadError: null, external: "ext" }), "ext");
  assert.equal(pickerErrorMessage({ pinError: null, loadError: null, external: null }), null);
});

test("every validation issue code has a translated message in all three locales", async () => {
  for (const [file, marker] of [
    ["../lib/i18n/messages/en.ts", "File name is required"],
    ["../lib/i18n/messages/zh-CN.ts", "请输入文件名"],
    ["../lib/i18n/messages/zh-TW.ts", "請輸入檔案名稱"],
  ]) {
    const localeSource = await readFile(new URL(file, import.meta.url), "utf8");
    for (const issue of NEW_FILE_NAME_ISSUES) {
      assert.match(
        localeSource,
        new RegExp(`directoryPicker\\.validation\\.${issue}"`),
        `${file} must translate the '${issue}' validation code`,
      );
    }
    assert.ok(localeSource.includes(marker), `${file} carries locale-appropriate copy`);
  }
});


// ---------------------------------------------------------------------------
// createCreateFlow (review P2 races): deferred-response interaction tests
// driving the REAL production flow — cancel/reopen during a pending
// creation, and navigation during a pending folder creation.
// ---------------------------------------------------------------------------

function jsonResponse200(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Sequenceable fetch: `plan` entries are {response} to answer immediately
 * or {defer:true} to hang until the returned release() fires. */
function plannedFetch(plan) {
  const calls = [];
  const gates = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const step = plan.length > 0 ? plan.shift() : {};
    if (step.defer) await new Promise((resolve) => gates.push(resolve));
    return step.response ?? jsonResponse200({ ok: true });
  };
  return { fetchFn, calls, release: () => gates.shift()?.() };
}

function flowHarness(deps = {}) {
  const state = { kind: null, name: "", error: null, busy: false, notice: null };
  const navigated = [];
  const refetched = [];
  let displayedPath = deps.displayed ?? "/work";
  const flow = createCreateFlow({
    t: (key) => key,
    fetchFn: deps.fetchFn,
    setKind: (kind) => { state.kind = kind; },
    setName: (name) => { state.name = name; },
    setError: (message) => { state.error = message; },
    setBusy: (busy) => { state.busy = busy; },
    setNotice: (message) => { state.notice = message; },
    displayedPath: () => displayedPath,
    navigateTo: (directory) => navigated.push(directory),
    refetchCurrent: () => refetched.push(displayedPath),
  });
  return {
    flow, state, navigated, refetched,
    navigateAway: (to) => { displayedPath = to; },
  };
}

test("cancel during a pending file create keeps the operation's busy state and completes cleanly", async () => {
  const { fetchFn, calls, release } = plannedFetch([
    { response: jsonResponse200({ cwd: "/work" }) },
    { defer: true },
  ]);
  const h = flowHarness({ fetchFn });
  h.flow.open("file");
  assert.equal(h.state.kind, "file");

  const submission = h.flow.submit("file", "notes.md");
  // Let the request chain advance: validate answers, the create fetch hangs.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.busy, true, "the create request owns the busy flag");
  assert.equal(calls.length, 2, "parent validate + create were issued");

  // Cancel mid-flight is a NO-OP: the form STAYS visible (hiding it would
  // swallow the operation's eventual in-dialog failure) and the busy state
  // keeps the in-flight request's ownership.
  h.flow.cancel();
  assert.equal(h.state.kind, "file", "the form stays visible while pending");
  assert.equal(h.state.busy, true, "cancel must not clear the pending operation's busy state");

  // …and no replacement form may open while the creation is pending.
  h.flow.open("folder");
  assert.equal(h.state.kind, "file", "no replacement form while pending");

  // The deferred completion lands: busy clears, the notice confirms, the
  // listing refreshes — never a navigation.
  release();
  await submission;
  assert.equal(h.state.busy, false);
  assert.equal(h.state.notice, "directoryPicker.fileCreated");
  assert.equal(h.refetched.length, 1, "the listing refreshed once");
  assert.deepEqual(h.navigated, [], "a file create never navigates");

  // After completion, opening works again.
  h.flow.open("folder");
  assert.equal(h.state.kind, "folder");
  // And on an idle form, cancel hides it.
  h.flow.cancel();
  assert.equal(h.state.kind, null, "an idle form still cancels");
});

test("a pending creation's FAILURE renders in the still-open form (no swallow)", async () => {
  const conflict = new Response(JSON.stringify({ error: "exists" }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
  const { fetchFn, release } = plannedFetch([
    { response: jsonResponse200({ cwd: "/work" }) },
    { defer: true, response: conflict },
  ]);
  const h = flowHarness({ fetchFn });
  h.flow.open("file");
  const submission = h.flow.submit("file", "notes.md");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.busy, true);

  // The cancel attempt is refused mid-flight; the 409 conflict then lands in
  // the STILL-OPEN form, satisfying the in-dialog failure contract.
  h.flow.cancel();
  release();
  await submission;
  assert.equal(h.state.busy, false);
  assert.equal(h.state.error, "directoryPicker.createFileConflict");
  assert.equal(h.state.kind, "file", "the form remains open showing the failure");
});

test("a folder completion navigates ONLY when the picker still displays the submit-time directory", async () => {
  // Case 1: the user stayed — navigate into the created folder.
  {
    const { fetchFn } = plannedFetch([
      { response: jsonResponse200({ cwd: "/work" }) },
      { response: jsonResponse200({ ok: true }) },
    ]);
    const h = flowHarness({ fetchFn });
    await h.flow.submit("folder", "new-dir");
    assert.deepEqual(h.navigated, ["/work/new-dir"], "folder success enters the created folder");
    assert.equal(h.refetched.length, 0);
  }
  // Case 2: the user navigated away while the creation was in flight — the
  // completion refreshes what is DISPLAYED, never yanks the picker into
  // the created folder.
  {
    const { fetchFn, release } = plannedFetch([
      { response: jsonResponse200({ cwd: "/work" }) },
      { defer: true },
    ]);
    const h = flowHarness({ fetchFn });
    const submission = h.flow.submit("folder", "new-dir");
    // Advance to the hanging create fetch before navigating away.
    await new Promise((resolve) => setImmediate(resolve));
    h.navigateAway("/elsewhere");
    release();
    await submission;
    assert.deepEqual(h.navigated, [], "no navigation away from the user's current directory");
    assert.deepEqual(h.refetched, ["/elsewhere"], "the displayed listing is refreshed instead");
  }
});

test("an unsafe file name is rejected with zero requests and a translated message", async () => {
  const { fetchFn, calls } = plannedFetch([]);
  const h = flowHarness({ fetchFn });
  await h.flow.submit("file", "a/b");
  assert.equal(calls.length, 0, "no request is issued for an unsafe name");
  assert.equal(h.state.error, "directoryPicker.validation.pathSeparator");
  assert.equal(h.state.busy, false);
  // The local rejection leaves the busy flag untouched and no notice set.
  assert.equal(h.state.notice, null);
});
