import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const {
  AgentResourceControls,
  ResourcePickerList,
  ResourceSummary,
  bindResourcePickerDismissal,
  classifyResourceSelection,
  closeResourcePicker,
  filterResourceItems,
  focusResourcePickerTrigger,
  isResourceItemChecked,
  isResourcePickerOutside,
  observeResourcePickerVisibility,
  openResourcePickerDialog,
  removeResourceEntry,
  resourceDisplayName,
  resourceBulkState,
  resourcePickerLayout,
  resourceSelectionBase,
  resourceSelectionStatus,
  selectAllResourceItems,
  toggleResourceItem,
} = await jiti.import("./AgentResourceControls.tsx");
const { matchingResourceEntries: matchingEntries, resourceMatchCandidates } = await jiti.import("../lib/subagent-resource-selection.ts");

const source = await readFile(new URL("./AgentResourceControls.tsx", import.meta.url), "utf8");
const agents = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

const h = React.createElement;
const render = (element) => renderToStaticMarkup(h(I18nProvider, null, element));
const noop = () => {};

function item(path, names, overrides = {}) {
  return {
    name: names[0],
    path,
    identity: overrides.identity ?? path,
    names,
    pathAliases: overrides.pathAliases ?? [path, `~${path}`, `./${path.slice(1)}`],
    metadata: { source: "configured", scope: "global", origin: "top-level", baseDir: "/base", ...overrides.metadata },
    enabled: overrides.enabled ?? true,
  };
}

/** A node of a minimal DOM tree, with a synchronous `emit` for the listener tests. */
class FakeNode {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.listeners = [];
    this.isConnected = true;
    this.focused = [];
  }

  addEventListener(type, listener) { this.listeners.push({ type, listener }); }
  removeEventListener(type, listener) { this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.listener === listener)); }
  focus(options) { this.focused.push(options); }
  getClientRects() { return [{}]; }
  contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false; }

  emit(type, init = {}) {
    const event = Object.assign(init, { type });
    for (const entry of [...this.listeners]) if (entry.type === type) entry.listener.call(this, event);
    return event;
  }
}

/** Window/DOM seams live only in this test file; production uses the native types. */
class PointerWindowMock extends EventTarget {
  constructor(coarse = false, width = 1024) {
    super();
    this.coarse = coarse;
    this.innerWidth = width;
    this.queries = [];
  }

  matchMedia(query) {
    this.queries.push(query);
    return { matches: this.coarse, media: query };
  }
}

function fakeDocument() {
  const doc = new FakeNode("document");
  doc.body = new FakeNode("body", doc);
  doc.defaultView = new PointerWindowMock();
  doc.activeElement = doc.body;
  return doc;
}

function escapeEvent() {
  return {
    key: "Escape",
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

test("editor resolves aliases to unique real identities, preserves unknown/colliding names, and supports slash variants", () => {
  const first = item("/first.ts", ["first"]), second = item("/second.ts", ["second"]);
  assert.deepEqual(matchingEntries("FIRST", [first, second]), [first]);
  assert.deepEqual(matchingEntries("\\first.ts", [first]), [first]);
  assert.deepEqual(matchingEntries("~/first.ts", [first]), [first]);
  assert.deepEqual(matchingEntries("./first.ts", [first]), [first]);
  assert.deepEqual(matchingEntries("missing", [first]), []);
  assert.deepEqual(matchingEntries("first", [first, item("/other.ts", ["first"])]), []);
  assert.deepEqual(matchingEntries("first", [first, item("/alias.ts", ["first"], { identity: "/first.ts" })]).length, 2);
});

test("a summary counts explicit entries and flags unknown/ambiguous only once the catalog is ready", () => {
  const entries = [item("/a.ts", ["alpha"]), item("/b.ts", ["beta"])];
  assert.deepEqual(classifyResourceSelection(true, entries, true), { mode: "all", selectedCount: 0, hasWildcard: false, unknown: [], ambiguous: [] });
  assert.equal(classifyResourceSelection(false, entries, true).mode, "none");
  const selected = classifyResourceSelection(["alpha", "missing", "*"], entries, true);
  assert.deepEqual([selected.mode, selected.selectedCount, selected.hasWildcard], ["selected", 2, true]);
  assert.deepEqual(selected.unknown, ["missing"]);
  // Before the catalog arrives a draft is never mislabelled unknown and kept.
  const pending = classifyResourceSelection(["missing"], [], false);
  assert.deepEqual([pending.unknown, pending.selectedCount], [[], 1]);
  const ambiguous = classifyResourceSelection(["dup"], [item("/one.ts", ["dup"]), item("/two.ts", ["dup"])], true);
  assert.deepEqual(ambiguous.ambiguous, ["dup"]);
  assert.deepEqual(ambiguous.unknown, []);
  assert.equal(resourceMatchCandidates("dup", [item("/one.ts", ["dup"]), item("/two.ts", ["dup"])]).length, 2);
});

test("checkbox edits keep the stored path, retain unknowns until explicit removal, and drop the wildcard on its own", () => {
  const first = item("/a.ts", ["alpha"]), second = item("/b.ts", ["beta"]);
  assert.deepEqual(resourceSelectionBase(true, [first, second]), ["/a.ts", "/b.ts"]);
  assert.deepEqual(resourceSelectionBase(false, [first, second]), []);
  // A wildcard first edit expands to the enabled paths plus the explicit entries,
  // keeping an unknown and never adding a future catalog entry as selected.
  assert.deepEqual(resourceSelectionBase(["*", "unknown"], [first, second]), ["unknown", "/a.ts", "/b.ts"]);
  assert.deepEqual(resourceSelectionBase(["*", "/a.ts"], [first, second]), ["/a.ts", "/b.ts"]);
  assert.deepEqual(toggleResourceItem([], first, true, [first, second]), ["/a.ts"]);
  assert.equal(isResourceItemChecked(["/a.ts"], first, [first, second]), true);
  assert.equal(isResourceItemChecked(false, first, [first, second]), false);
  assert.equal(isResourceItemChecked(true, first, [first, second]), true);
  assert.deepEqual(toggleResourceItem(["/a.ts"], first, false, [first, second]), []);
  // All minus one stays an explicit list of the rest, never a display name.
  assert.deepEqual(toggleResourceItem(true, first, false, [first, second]), ["/b.ts"]);
  // A row can be unchecked while the wildcard is present: the wildcard is dropped
  // and converted in one click, and an unknown entry survives the edit.
  assert.deepEqual(toggleResourceItem(["*"], first, false, [first, second]), ["/b.ts"]);
  assert.deepEqual(toggleResourceItem(["*", "unknown"], first, false, [first, second]), ["unknown", "/b.ts"]);
  assert.deepEqual(toggleResourceItem(["*", "unknown"], second, true, [first, second]), ["unknown", "/a.ts", "/b.ts"]);
  assert.deepEqual(toggleResourceItem(["alpha"], first, false, [first, second]), []);
  assert.deepEqual(removeResourceEntry(["/a.ts", "missing", "*"], "missing"), ["/a.ts", "*"]);
  assert.deepEqual(removeResourceEntry(["/a.ts", "missing", "*"], "*"), ["/a.ts", "missing"]);
  assert.deepEqual(removeResourceEntry(["*"], "*"), []);
  assert.equal(removeResourceEntry(true, "*"), true);
});

test("a packaged skill keeps its own effective name while a packaged extension shows the package name", () => {
  const review = item("/pkg/skills/review-code/SKILL.md", ["review-code"], { metadata: { origin: "package", source: "npm:dev-skills@1.0.0" } });
  const write = item("/pkg/skills/write-tests/SKILL.md", ["write-tests"], { metadata: { origin: "package", source: "npm:dev-skills@1.0.0" } });
  const extension = item("/pkg/node_modules/pi-browser-harness/dist/index.js", ["dist", "pi-browser-harness"], {
    metadata: { origin: "package", source: "npm:pi-browser-harness@1.0.0", packageRoot: "/pkg/node_modules/pi-browser-harness" },
  });
  assert.equal(resourceDisplayName(review, "skills"), "review-code");
  assert.equal(resourceDisplayName(write, "skills"), "write-tests");
  assert.equal(resourceDisplayName(extension, "extensions"), "pi-browser-harness");
  assert.equal(resourceDisplayName(item("/x.ts", ["plain"]), "extensions"), "plain");
  assert.equal(resourceDisplayName(item("/x.ts", ["plain"]), "skills"), "plain");
  // The identity/path offered to the draft does not change with the shown name.
  assert.deepEqual(toggleResourceItem([], extension, true, [extension]), [extension.path]);
});

test("search filters on the shown name and aliases without touching the selection", () => {
  const entries = [item("/a.ts", ["alpha"]), item("/b.ts", ["beta"])];
  assert.deepEqual(filterResourceItems(entries, "ALP", "extensions").map((entry) => entry.path), ["/a.ts"]);
  assert.deepEqual(filterResourceItems(entries, "beta", "skills"), [entries[1]]);
  assert.deepEqual(filterResourceItems(entries, "  ", "skills"), entries);
});

test("picker layout strictly clamps both edges, handles an off-screen anchor and a short viewport", () => {
  const below = resourcePickerLayout({ top: 100, bottom: 130, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.deepEqual([below.above, below.top, below.left, below.width, below.maxHeight, below.offscreen], [false, 136, 8, 420, 380, false]);

  const flipped = resourcePickerLayout({ top: 520, bottom: 550, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.deepEqual([flipped.above, flipped.top, flipped.maxHeight, flipped.offscreen], [true, 134, 380, false]);

  const tight = resourcePickerLayout({ top: 260, bottom: 290, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.equal(tight.maxHeight, 296);

  const phone = resourcePickerLayout({ top: 300, bottom: 340, left: 0, width: 374 }, { width: 390, height: 780 });
  assert.deepEqual([phone.left, phone.width], [8, 374]);
  assert.ok(phone.maxHeight <= 380);

  // The reported bug: an anchor above the viewport must not put the header at -104.
  const offTop = resourcePickerLayout({ top: -150, bottom: -110, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.equal(offTop.offscreen, true);
  assert.equal(offTop.above, false);
  assert.equal(offTop.top, 8);
  assert.ok((offTop.top ?? 0) >= 8 && (offTop.top ?? 0) + offTop.maxHeight <= 592, "the panel stays inside the viewport");

  const offBottom = resourcePickerLayout({ top: 700, bottom: 730, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.equal(offBottom.offscreen, true);
  assert.equal(offBottom.above, true);
  assert.equal(offBottom.top, 212);
  assert.ok(offBottom.top >= 8 && offBottom.top + offBottom.maxHeight <= 592, "the flipped panel stays inside the viewport");

  // A short viewport: no forced 96px minimum that crosses the bottom edge.
  const short = resourcePickerLayout({ top: 80, bottom: 110, left: 20, width: 200 }, { width: 400, height: 200 });
  assert.equal(short.offscreen, false);
  assert.equal(short.maxHeight, 76);
  assert.ok((short.top ?? 0) + short.maxHeight <= 192);

  // A visualViewport shift changes the visible bounds, NOT the fixed anchor coordinates.
  const shifted = resourcePickerLayout({ top: 250, bottom: 280, left: 20, width: 200 }, { width: 800, height: 600, offsetTop: 100 });
  assert.deepEqual([shifted.offscreen, shifted.top, shifted.maxHeight], [false, 286, 380]);

  // Partially past the top edge is still on-screen; the panel clamps below the anchor.
  const partial = resourcePickerLayout({ top: -10, bottom: 30, left: 20, width: 200 }, { width: 800, height: 600 });
  assert.deepEqual([partial.offscreen, partial.top], [false, 36]);
});

test("offset viewport boundaries clamp in layout coordinates, including near-bottom, margins and narrow zoom", () => {
  const viewport = { width: 500, height: 600, offsetLeft: 100, offsetTop: 100 };
  const aligned = resourcePickerLayout({ top: 250, bottom: 280, left: 520, width: 52 }, viewport);
  assert.equal(aligned.top, 286);
  assert.equal(aligned.left + aligned.width, 572, "align to the actual trigger right without subtracting offsetLeft");
  const rightEdge = resourcePickerLayout({ top: 250, bottom: 280, left: 580, width: 52 }, viewport);
  assert.equal(rightEdge.left + rightEdge.width, 592);
  const nearBottom = resourcePickerLayout({ top: 650, bottom: 680, left: 520, width: 52 }, viewport);
  assert.deepEqual([nearBottom.above, nearBottom.top, nearBottom.maxHeight], [true, 264, 380]);
  assert.equal(nearBottom.top + nearBottom.maxHeight, 644, "flipped bottom remains one gap above trigger top");
  assert.equal("bottom" in nearBottom, false, "both opening directions use fixed top, not a second viewport reference");

  const margin = resourcePickerLayout({ top: 115, bottom: 145, left: -200, width: 52 }, viewport, { margin: 20, gap: 10, maxWidth: 240 });
  assert.deepEqual([margin.left, margin.width, margin.top], [120, 240, 155]);
  for (const width of [180, 120, 16, 10]) {
    const narrowViewport = { ...viewport, width };
    const narrow = resourcePickerLayout({ top: 250, bottom: 280, left: 160, width: 52 }, narrowViewport);
    assert.ok(narrow.width <= width, "no minimum width overflows a zoom-narrowed visual viewport");
    assert.ok(narrow.left >= viewport.offsetLeft);
    assert.ok(narrow.left + narrow.width <= viewport.offsetLeft + width);
  }
  for (const anchor of [
    { top: -100, bottom: -70, left: -100, width: 52 },
    { top: 900, bottom: 930, left: 900, width: 52 },
  ]) {
    const offscreen = resourcePickerLayout(anchor, viewport);
    assert.equal(offscreen.offscreen, true);
    assert.ok(offscreen.top >= 108);
    assert.ok(offscreen.top + offscreen.maxHeight <= 692);
    assert.ok(offscreen.left >= 108 && offscreen.left + offscreen.width <= 592);
  }
});

test("each picker aligns to its own button rather than the shared grid", () => {
  // User's side-by-side rows: clicking extensions must not put its picker under skills.
  const viewport = { width: 1160, height: 840 };
  const skills = resourcePickerLayout({ top: 540, bottom: 569, left: 632, width: 52 }, viewport);
  const extensions = resourcePickerLayout({ top: 540, bottom: 569, left: 1052, width: 52 }, viewport);
  assert.equal(skills.left + skills.width, 684);
  assert.equal(extensions.left + extensions.width, 1104);
  assert.equal(extensions.left - skills.left, 420);
  assert.equal(extensions.top, 575);
  const shifted = resourcePickerLayout({ top: 540, bottom: 569, left: 1052, width: 52 }, { ...viewport, width: 1000, offsetLeft: 100 });
  assert.equal(shifted.left + shifted.width, 1092, "right edge is clamped inside the shifted viewport");
  const phone = resourcePickerLayout({ top: 440, bottom: 469, left: 326, width: 52 }, { width: 390, height: 844 });
  assert.equal(phone.left, 8);
  assert.equal(phone.left + phone.width, 382);
});

test("the default block mounts both summary rows but never the list or an overlay", () => {
  const html = render(h(AgentResourceControls, {
    cwd: "/repo", trustKey: "global", profileKey: "global:a",
    skills: ["one", "unknown"], extensions: false, disabled: false, onChange: noop,
  }));
  assert.match(html, /data-kind="skills"/);
  assert.match(html, /data-kind="extensions"/);
  assert.match(html, /Load skills/);
  assert.match(html, /Load extensions/);
  assert.match(html, /data-kind="skills"[\s\S]*?2 enabled/);
  assert.match(html, /data-kind="extensions"[\s\S]*?Disabled/);
  assert.match(html, /Choose…/);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /agents-resource-mode/);
  assert.doesNotMatch(html, /Selection controls SDK resource loading/);
  assert.doesNotMatch(html, /Project extensions still require project trust/);
  assert.doesNotMatch(html, /agents-resource-picker/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("a summary reads All enabled / Disabled / a count, keeps the wildcard and warning, and readonly keeps its text", () => {
  const entries = [item("/a.ts", ["alpha"])];
  const selected = render(h(ResourceSummary, {
    kind: "skills", label: "Load skills", value: ["alpha", "missing", "*"], items: entries, catalogReady: true,
    disabled: false, open: false, onChoose: noop,
  }));
  assert.match(selected, /All enabled/);
  assert.match(selected, /class="agents-resource-wildcard-mark"[^>]*title="[^"]*"[^>]*>\*</);
  assert.match(selected, /role="alert"[^>]*class="agents-resource-warning"[^>]*>1 unknown or ambiguous; retained</);
  assert.doesNotMatch(selected, /<select/);
  const empty = render(h(ResourceSummary, {
    kind: "skills", label: "Load skills", value: [], items: entries, catalogReady: true,
    disabled: false, open: false, onChoose: noop,
  }));
  assert.match(empty, /Disabled/);
  const readonly = render(h(ResourceSummary, {
    kind: "extensions", label: "Load extensions", value: ["/b.ts"], items: [], catalogReady: false,
    disabled: true, open: false, onChoose: noop,
  }));
  assert.match(readonly, /1 enabled/);
  assert.doesNotMatch(readonly, /<select/);
  assert.match(readonly, /<button type="button" disabled=""[^>]*class="config-button config-button-secondary config-button-small agents-resource-choose">Choose…<\/button>/);
});

test("the list body renders distinct packaged skill names and package extension names, keeps unknown rows visible", () => {
  const entries = [
    item("/pkg/skills/review-code/SKILL.md", ["review-code"], { metadata: { origin: "package", source: "npm:dev-skills@1.0.0" } }),
    item("/pkg/skills/write-tests/SKILL.md", ["write-tests"], { metadata: { origin: "package", source: "npm:dev-skills@1.0.0" } }),
    item("/one.ts", ["dup"]),
    item("/two.ts", ["dup"]),
  ];
  let changed = 0;
  const skills = render(h(ResourcePickerList, {
    kind: "skills", value: ["missing", "dup"], items: entries, catalogReady: true, disabled: false,
    search: "", expanded: new Set(), onToggleExpand: noop, onChange: () => { changed += 1; },
  }));
  assert.match(skills, /aria-label="review-code"/);
  assert.match(skills, /aria-label="write-tests"/);
  assert.doesNotMatch(skills, /dev-skills/, "the package name never replaces a skill's own effective name");
  assert.match(skills, />missing</);
  assert.match(skills, /Unknown or ambiguous; retained, not loaded/);
  assert.match(skills, />dup</);
  assert.match(skills, /Ambiguous name; pick a concrete file/);

  const extensions = render(h(ResourcePickerList, {
    kind: "extensions", value: [], items: [item("/pkg/node_modules/pi-web-access/dist/index.js", ["dist", "pi-web-access"], {
      metadata: { origin: "package", source: "npm:pi-web-access@3.0.0", packageRoot: "/pkg/node_modules/pi-web-access" },
    })], catalogReady: true, disabled: false,
    search: "", expanded: new Set(["/pkg/node_modules/pi-web-access/dist/index.js"]), onToggleExpand: noop, onChange: noop,
  }));
  assert.match(extensions, /aria-label="pi-web-access"/);
  assert.match(extensions, /npm:pi-web-access@3\.0\.0/);
  assert.match(extensions, /\/pkg\/node_modules\/pi-web-access\/dist\/index\.js/);
  assert.equal(changed, 0, "rendering a list never invokes the draft callback");

  render(h(ResourcePickerList, {
    kind: "skills", value: [], items: entries, catalogReady: true, disabled: false,
    search: "review-code", expanded: new Set(), onToggleExpand: noop, onChange: () => { changed += 1; },
  }));
  assert.equal(changed, 0, "typing a search only filters the visible rows");
});

test("dismissal binds mousedown and focusin: outside closes, the panel and both summary triggers stay", () => {
  const doc = fakeDocument();
  const panel = new FakeNode("panel", doc.body);
  const anchor = new FakeNode("anchor", doc.body);
  const outside = new FakeNode("elsewhere", doc.body);
  let closed = 0;
  const cleanup = bindResourcePickerDismissal(doc, panel, anchor, () => { closed += 1; });

  doc.emit("mousedown", { target: outside });
  assert.equal(closed, 1);
  doc.emit("mousedown", { target: panel });
  assert.equal(closed, 1, "a press inside the panel stays open");
  doc.emit("mousedown", { target: anchor });
  assert.equal(closed, 1, "a summary Choose press stays open so the other dimension can switch");

  doc.emit("focusin", { target: outside });
  assert.equal(closed, 2, "Tab leaving the picker closes it");
  doc.emit("focusin", { target: panel });
  doc.emit("focusin", { target: anchor });
  assert.equal(closed, 2, "focus inside the panel or a summary trigger stays open");
  doc.emit("focusin", { target: doc.body });
  assert.equal(closed, 2, "focus dropped to body keeps the picker; the visibility observer handles hidden sections");

  cleanup();
  doc.emit("mousedown", { target: outside });
  assert.equal(closed, 2, "cleanup removes the listeners");
});

test("a native Tab that reaches the document boundary dismisses the picker, and a switch cleanup cancels a pending check", async () => {
  const doc = fakeDocument();
  const panel = new FakeNode("panel", doc.body);
  const anchor = new FakeNode("anchor", doc.body);
  const inside = new FakeNode("checkbox", panel);
  const pageControl = new FakeNode("settings control", doc.body);
  let closed = 0;
  const cleanup = bindResourcePickerDismissal(doc, panel, anchor, () => { closed += 1; });

  // Tab still lands inside the picker: the deferred check keeps it open.
  doc.activeElement = inside;
  doc.emit("keydown", { key: "Tab" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, 0);

  // Tab to a real page control: the immediate focusin path already closed it.
  doc.emit("focusin", { target: pageControl });
  assert.equal(closed, 1);

  // Tab to BODY (browser-chrome/document boundary) fires no focusin; the deferred
  // check closes it.
  doc.activeElement = doc.body;
  doc.emit("keydown", { key: "Tab" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, 2);

  // A kind switch unmounts the old picker: its pending check is cleared and the new
  // picker's focus is never falsely dismissed.
  let switched = 0;
  const cleanupSwitch = bindResourcePickerDismissal(doc, panel, anchor, () => { switched += 1; });
  doc.activeElement = doc.body;
  doc.emit("keydown", { key: "Tab" });
  cleanupSwitch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(switched, 0);

  cleanup();
});

test("Escape is an explicit close: it restores this picker's trigger and a kind switch never disturbs the new one", () => {
  const doc = fakeDocument();
  const skillsTrigger = new FakeNode("skills trigger", doc.body);
  const extensionsTrigger = new FakeNode("extensions trigger", doc.body);
  const skillsSearch = new FakeNode("skills search", doc.body);
  const extensionsSearch = new FakeNode("extensions search", doc.body);
  let skillsClosed = 0, extensionsClosed = 0;

  const stopSkills = openResourcePickerDialog(doc, () => closeResourcePicker(skillsTrigger, () => { skillsClosed += 1; }), null, skillsSearch);
  assert.deepEqual(skillsSearch.focused, [{ preventScroll: true }], "the picker focuses its own search");
  // React unmounts the old picker before the new one's effect; cleanup moves no focus.
  stopSkills();
  assert.equal(skillsTrigger.focused.length, 0, "the switching cleanup does not refocus the old trigger");
  const stopExtensions = openResourcePickerDialog(doc, () => closeResourcePicker(extensionsTrigger, () => { extensionsClosed += 1; }), null, extensionsSearch);
  assert.deepEqual(extensionsSearch.focused, [{ preventScroll: true }], "the new picker focuses its own search");

  const event = escapeEvent();
  doc.emit("keydown", event);
  assert.deepEqual([skillsClosed, extensionsClosed], [0, 1], "Escape closes the current picker only");
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(extensionsTrigger.focused, [{ preventScroll: true }], "Escape returns focus to the current trigger");
  assert.equal(skillsTrigger.focused.length, 0, "the old skills trigger is not touched by a later close");
  stopExtensions();
});

test("opening samples pointer capability, not width; native resize and breakpoint changes never refocus", () => {
  for (const [coarse, width] of [[true, 1200], [false, 390]]) {
    const doc = fakeDocument();
    const win = new PointerWindowMock(coarse, width);
    doc.defaultView = win;
    const panel = new FakeNode("panel", doc.body);
    const search = new FakeNode("search", panel);
    let closed = 0;
    const cleanup = openResourcePickerDialog(doc, () => { closed += 1; }, panel, search);
    assert.deepEqual(win.queries, ["(pointer: coarse)"]);
    assert.equal(panel.focused.length, coarse ? 1 : 0, "a wide coarse-pointer device focuses the panel");
    assert.equal(search.focused.length, coarse ? 0 : 1, "a narrow fine-pointer window focuses search");
    win.innerWidth = width === 390 ? 1200 : 390;
    win.coarse = !coarse;
    win.dispatchEvent(new Event("resize"));
    win.dispatchEvent(new Event("scroll"));
    assert.equal(panel.focused.length + search.focused.length, 1, "one open has one initial focus, regardless of resize");
    assert.equal(win.queries.length, 1, "capability is sampled only on opening");
    doc.emit("keydown", escapeEvent());
    assert.equal(closed, 1, "Escape remains registered after resize");
    cleanup();
    doc.emit("keydown", escapeEvent());
    assert.equal(closed, 1, "cleanup removes Escape without moving focus");
    assert.equal(panel.focused.length + search.focused.length, 1);
  }
});

test("native EventTarget lifecycle cleans up Escape, outside focus and deferred Tab-to-body listeners", async () => {
  // Native event dispatch, with DOM nodes/window represented by local fixtures.
  // Node's EventTarget fails to remove capture listeners with the boolean overload;
  // normalize that browser-supported overload here, never in production helpers.
  class NativeDocumentFixture extends EventTarget {
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, typeof options === "boolean" ? { capture: options } : options);
    }
  }
  const doc = new NativeDocumentFixture();
  doc.body = new FakeNode("body");
  doc.activeElement = doc.body;
  doc.defaultView = new PointerWindowMock(true, 1200);
  const panel = new FakeNode("panel", doc.body);
  const search = new FakeNode("search", panel);
  const anchor = new FakeNode("summary", doc.body);
  const trigger = new FakeNode("trigger", anchor);
  let closed = 0;
  const stopDialog = openResourcePickerDialog(doc, () => closeResourcePicker(trigger, () => { closed += 1; }), panel, search);
  const stopDismiss = bindResourcePickerDismissal(doc, panel, anchor, () => { closed += 1; });
  const dispatch = (type, properties) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    doc.dispatchEvent(event);
    return event;
  };
  assert.equal(panel.focused.length, 1);
  assert.equal(search.focused.length, 0);
  const escape = dispatch("keydown", { key: "Escape", isComposing: false, keyCode: 0 });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(closed, 1);
  assert.equal(trigger.focused.length, 1, "only explicit close restores the trigger");
  dispatch("focusin", { target: doc.body });
  assert.equal(closed, 1, "ordinary body focus is ignored");
  dispatch("keydown", { key: "Tab" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, 2, "native Tab to body closes without focusin");
  dispatch("focusin", { target: new FakeNode("external input", doc.body) });
  assert.equal(closed, 3);
  dispatch("keydown", { key: "Tab" });
  stopDialog();
  stopDismiss();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dispatch("keydown", { key: "Escape", isComposing: false, keyCode: 0 });
  dispatch("mousedown", { target: doc.body });
  assert.equal(closed, 3, "cleanup removes native listeners and cancels the pending Tab check");
  assert.equal(trigger.focused.length, 1, "automatic dismissal and cleanup never restore focus");
});

test("an outside focusin closes the picker and cleanup keeps the new external focus", () => {
  const doc = fakeDocument();
  const panel = new FakeNode("panel", doc.body);
  const anchor = new FakeNode("anchor", doc.body);
  const trigger = new FakeNode("trigger", doc.body);
  const external = new FakeNode("external input", doc.body);
  const search = new FakeNode("search", panel);
  let closed = 0;
  const stopDialog = openResourcePickerDialog(doc, () => closeResourcePicker(trigger, () => { closed += 1; }), panel, search);
  const stopDismiss = bindResourcePickerDismissal(doc, panel, anchor, () => { closed += 1; });

  external.focus({ preventScroll: true });
  doc.emit("focusin", { target: external });
  assert.equal(closed, 1, "the outside focusin closes the picker");
  stopDialog();
  stopDismiss();
  assert.equal(trigger.focused.length, 0, "cleanup does not steal focus back to the trigger");
  assert.deepEqual(external.focused, [{ preventScroll: true }], "the external focus target keeps focus");
});

test("an outside mousedown followed by an external focus keeps that focus through cleanup", () => {
  const doc = fakeDocument();
  const panel = new FakeNode("panel", doc.body);
  const anchor = new FakeNode("anchor", doc.body);
  const trigger = new FakeNode("trigger", doc.body);
  const external = new FakeNode("external input", doc.body);
  const search = new FakeNode("search", panel);
  let closed = 0;
  const stopDialog = openResourcePickerDialog(doc, () => closeResourcePicker(trigger, () => { closed += 1; }), panel, search);
  const stopDismiss = bindResourcePickerDismissal(doc, panel, anchor, () => { closed += 1; });

  doc.emit("mousedown", { target: external });
  // The browser's default action focuses the pressed input after the handler.
  external.focus({ preventScroll: true });
  stopDialog();
  stopDismiss();
  assert.equal(closed, 1);
  assert.equal(trigger.focused.length, 0, "cleanup does not grab focus after an outside press");
  assert.deepEqual(external.focused, [{ preventScroll: true }]);
});

test("an explicit close never focuses a hidden or detached trigger", () => {
  const detached = new FakeNode("detached trigger");
  detached.isConnected = false;
  let closed = 0;
  closeResourcePicker(detached, () => { closed += 1; });
  assert.equal(detached.focused.length, 0);
  assert.equal(closed, 1, "the close still happens");

  const hiddenSection = new FakeNode("hidden-section trigger");
  hiddenSection.getClientRects = () => [];
  closeResourcePicker(hiddenSection, () => { closed += 1; });
  assert.equal(hiddenSection.focused.length, 0, "a connected but hidden trigger is not focused");
  assert.equal(closed, 2);
  assert.equal(focusResourcePickerTrigger(detached), false);
  assert.equal(focusResourcePickerTrigger(hiddenSection), false);
});

test("the visibility observer closes a hidden or scrolled-away anchor", () => {
  const instances = [];
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; instances.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const anchor = { name: "grid" };
  let hidden = 0;
  const cleanup = observeResourcePickerVisibility({ IntersectionObserver: FakeIntersectionObserver }, anchor, () => { hidden += 1; });
  const observer = instances[0];
  assert.equal(observer.target, anchor);
  observer.callback([{ isIntersecting: true }]);
  assert.equal(hidden, 0);
  observer.callback([{ isIntersecting: false }]);
  assert.equal(hidden, 1, "a section hidden or an anchor scrolled fully away closes the picker");
  cleanup();
  assert.equal(observer.disconnected, true);

  const noopCleanup = observeResourcePickerVisibility({}, anchor, () => { hidden += 1; });
  assert.equal(typeof noopCleanup, "function");
  noopCleanup();
});

test("outside targets are classified before any dismiss", () => {
  const panel = new FakeNode("panel");
  const anchor = new FakeNode("anchor");
  assert.equal(isResourcePickerOutside(panel, panel, anchor), false);
  assert.equal(isResourcePickerOutside(anchor, panel, anchor), false);
  assert.equal(isResourcePickerOutside(new FakeNode("elsewhere"), panel, anchor), true);
  assert.equal(isResourcePickerOutside(null, panel, anchor), false);
});

test("the overlay portals above the settings scroller, anchors to the active trigger, and repositions on scroll/resize", () => {
  assert.match(source, /const rect = trigger\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(source, /anchor=\{gridRef\.current\}/);
  assert.match(source, /summaryBoundary=\{gridRef\.current\}/);
  assert.match(source, /openKind && gridRef\.current && trigger &&/);
  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(source, /createPortal\(\s*<div[\s\S]*?agents-resource-picker/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /position: "fixed"/);
  assert.match(source, /top: layout\.top/);
  assert.doesNotMatch(source, /bottom: layout\.bottom/);
  assert.match(source, /layout\.top \+ Math\.max\(0, layout\.maxHeight - panel\.getBoundingClientRect\(\)\.height\)/);
  assert.match(source, /new ResizeObserver\(position\)/);
  assert.match(source, /observer\.observe\(panel\)/);
  assert.match(source, /window\.addEventListener\("scroll", updateLayout, true\)/);
  assert.match(source, /window\.addEventListener\("resize", updateLayout\)/);
  assert.match(source, /visualViewport\?\.addEventListener\("resize", updateLayout\)/);
  assert.match(source, /resourcePickerLayout\(/);
  assert.match(source, /next\.offscreen \|\| next\.maxHeight <= 0/);
  assert.match(css, /\.agents-resource-picker \{[\s\S]*?box-shadow/);
  assert.match(css, /\.agents-resource-path \{[\s\S]*?overflow-wrap: anywhere/);
});

test("the picker wires the tested lifecycle helpers and never writes a draft on open/close/search", () => {
  assert.match(source, /openResourcePickerDialog\(document, \(\) => closeResourcePicker\(trigger, \(\) => onCloseRef\.current\(\)\), panelRef\.current, searchRef\.current\),\s*\[trigger\]/);
  assert.match(source, /matchMedia\("\(pointer: coarse\)"\)/);
  assert.doesNotMatch(source, /useIsMobile|isMobile|ResourcePickerDismissDocument|ResourcePickerFocusable|ResourcePickerIntersectionObserver|as unknown|as L/);
  assert.match(source, /agents-resource-picker-close"[^\n]*onClick=\{\(\) => closeResourcePicker\(trigger, onClose\)\}/);
  assert.match(source, /bindResourcePickerDismissal\(document, panelRef\.current, summaryBoundary, \(\) => onCloseRef\.current\(\)\)/);
  assert.match(source, /if \(event\.key !== "Tab"\) return/);
  assert.match(source, /isResourcePickerOutside\(doc\.activeElement, panel, anchor\)/);
  assert.match(source, /observeResourcePickerVisibility\(window, trigger, \(\) => onCloseRef\.current\(\)\)/);
  assert.match(source, /triggerRef=\{kind === "skills" \? skillsTriggerRef : extensionsTriggerRef\}/);
  assert.match(source, /onChange=\{\(next\) => onChange\(openKind, next\)\}/);
  assert.doesNotMatch(source, /onChange\("skills"|onChange\("extensions"/);
  assert.doesNotMatch(source, /role="menu"|role="menuitem"/);
});

test("the master bulk control selects every enabled row and clears back to disabled", () => {
  const first = item("/a.ts", ["alpha"]), second = item("/b.ts", ["beta"]), off = item("/c.ts", ["gamma"], { enabled: false });
  const items = [first, second, off];
  assert.equal(resourceBulkState(false, items), "none");
  assert.equal(resourceBulkState([], items), "none");
  assert.equal(resourceBulkState(["/a.ts"], items), "partial");
  assert.equal(resourceBulkState(["/a.ts", "/b.ts"], items), "all");
  assert.equal(resourceBulkState(true, items), "all");
  assert.equal(resourceBulkState(["*", "unknown"], items), "all");
  assert.equal(resourceBulkState(false, [off]), "none", "no enabled row leaves the control inert");
  // Select all stays an explicit list of currently enabled paths, keeps unknowns
  // and never turns into a boolean All that would open future resources.
  assert.deepEqual(selectAllResourceItems(false, items), ["/a.ts", "/b.ts"]);
  assert.deepEqual(selectAllResourceItems([], items), ["/a.ts", "/b.ts"]);
  assert.deepEqual(selectAllResourceItems(["/a.ts", "unknown"], items), ["/a.ts", "unknown", "/b.ts"]);
  assert.deepEqual(selectAllResourceItems(["*", "unknown"], items), ["unknown", "/a.ts", "/b.ts"]);
  const dupA = item("/dup-a.ts", ["dup"]), dupB = item("/dup-b.ts", ["dup"]);
  assert.deepEqual(selectAllResourceItems(["dup", "unknown"], [dupA, dupB, off]), ["dup", "unknown", "/dup-a.ts", "/dup-b.ts"], "ambiguous/unknown values survive while every enabled concrete path is included");
  const selectedAll = selectAllResourceItems(false, items);
  const later = item("/later.ts", ["later"]);
  assert.equal(isResourceItemChecked(selectedAll, later, [...items, later]), false, "explicit bulk selection does not enable future resources");
  // The control is an icon toggle in the picker header; the clear action writes false.
  assert.match(source, /resourceBulkState\(value, items\)/);
  assert.match(source, /onChange\(bulk === "all" \? false : selectAllResourceItems\(value, items\)\)/);
  assert.match(source, /className="agents-resource-picker-bulk"/);
  assert.match(source, /aria-pressed=\{bulk === "partial" \? "mixed" : bulk === "all"\}/);
  assert.match(source, /agents\.resource\.selectAll/);
  assert.match(source, /agents\.resource\.clearAll/);
  assert.match(css, /\.agents-resource-picker-bulk/);
});

test("the status word maps booleans, wildcards and counts without treating unknowns as deleted", () => {
  assert.equal(resourceSelectionStatus({ mode: "all", selectedCount: 0, hasWildcard: false, unknown: [], ambiguous: [] }), "all");
  assert.equal(resourceSelectionStatus({ mode: "none", selectedCount: 0, hasWildcard: false, unknown: [], ambiguous: [] }), "none");
  assert.equal(resourceSelectionStatus({ mode: "selected", selectedCount: 0, hasWildcard: false, unknown: [], ambiguous: [] }), "none");
  assert.equal(resourceSelectionStatus({ mode: "selected", selectedCount: 2, hasWildcard: false, unknown: [], ambiguous: [] }), "selected");
  assert.equal(resourceSelectionStatus({ mode: "selected", selectedCount: 0, hasWildcard: true, unknown: [], ambiguous: [] }), "all");
  assert.doesNotMatch(source, /<select/);
  assert.doesNotMatch(source, /agents-resource-mode/);
  assert.doesNotMatch(source, /agents\.resource\.note|agents\.resource\.trust/);
  assert.match(source, /resourceSelectionStatus\(summary\)/);
  assert.match(source, /if \(catalogReady\) \{[\s\S]*?resourceMatchCandidates/);
  assert.doesNotMatch(source, /function allResourceMatches|replaceAll/);
  assert.match(source, /summary\.unknown[\s\S]*?summary\.ambiguous|summary\.ambiguous[\s\S]*?summary\.unknown/);
  assert.match(source, /removeResourceEntry\(value, entry\)/);
  assert.match(source, /resourceSelectionBase/);
  assert.doesNotMatch(source, /filter\(\(entry\) => catalog\.skills\.some/);
});

test("one picker at a time, closed by a new profile, cwd, trust or readonly", () => {
  assert.match(source, /const \[picker, setPicker\] = useState<SubagentResourceKind \| null>\(null\)/);
  assert.match(source, /open=\{openKind === kind\}/);
  assert.match(source, /key=\{openKind\}/);
  assert.match(source, /setPicker\(null\)/);
  assert.match(source, /\}, \[cwd, trustKey, profileKey, disabled\]\)/);
});

test("catalog error/retry and late-response cancellation never replace a draft", () => {
  assert.match(source, /controller\.signal\.aborted/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /\[cwd, trustKey, retry\]/);
  assert.match(source, /response\.ok[\s\S]*?Array\.isArray\(data\.skills\)/);
  assert.match(source, /role="alert"[\s\S]*?setRetry/);
  assert.doesNotMatch(source, /setDraft/);
  assert.match(agents, /skills: profile\.skills \?\? profile\.loadSkills/);
  assert.match(agents, /extensions: profile\.extensions \?\? profile\.loadExtensions/);
  assert.match(agents, /extensionTools: profile\.extensionTools/);
  assert.match(agents, /setCloneFrom\(\{ name: selected\.name, scope: selected\.scope \}\)/);
  assert.match(agents, /profileKey=\{selectedKey \?\? "create"\}/);
});
