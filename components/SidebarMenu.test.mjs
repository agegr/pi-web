import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  SidebarMenu,
  SidebarMenuSurface,
  placeSidebarMenu,
  findSidebarMenuShortcut,
  menuFocusReturnTarget,
  menuBodyFocusTarget,
  filterSidebarMenuItems,
  sidebarMenuHasFilter,
  hasCustomMenuBody,
  SIDEBAR_MENU_FILTER_MIN_CHOICES,
} = await jiti.import("./SidebarMenu.tsx");
const { SpinnerIcon, MoreIcon, PinIcon, TrashIcon } = await jiti.import("./SidebarIcons.tsx");
const css = await readFile(new URL("../app/sidebar-menu.css", import.meta.url), "utf8");

const h = React.createElement;

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

const noop = () => {};
const items = [
  { type: "header", id: "head", label: "New session in which worktree?" },
  { type: "item", id: "pin", label: "Pin", icon: h(PinIcon), shortcut: "P", onSelect: noop },
  { type: "item", id: "main", label: "main", mono: true, note: "main", checked: true, onSelect: noop },
  { type: "item", id: "feature", label: "feature/x", mono: true, checked: false, title: "/work/app-worktrees/feature-x", onSelect: noop },
  { type: "item", id: "archive", label: "Archive", shortcut: "A", disabled: true, disabledReason: "Running", onSelect: noop },
  { type: "separator", id: "sep" },
  { type: "item", id: "delete", label: "Delete…", shortcut: "D", danger: true, onSelect: noop },
];

function surface(props = {}) {
  return decode(renderToStaticMarkup(h(SidebarMenuSurface, {
    sheet: false,
    ariaLabel: "Session actions",
    items,
    cancelLabel: "Cancel",
    onActivate: noop,
    onClose: noop,
    ...props,
  })));
}

test("the menu waits for the client before portaling, so server markup is empty", () => {
  const html = renderToStaticMarkup(h(SidebarMenu, {
    open: true,
    anchor: { kind: "point", x: 10, y: 10 },
    sheet: false,
    ariaLabel: "Session actions",
    items,
    cancelLabel: "Cancel",
    onClose: noop,
  }));
  assert.equal(html, "");
});

test("desktop menu markup: menu roles, check marks, shortcuts, notes and disabled reasons", () => {
  const html = surface();
  assert.match(html, /^<div class="sidebar-menu" role="menu" aria-label="Session actions" style="width:208px">/);
  assert.match(html, /<div class="sidebar-menu-header" role="presentation">New session in which worktree\?<\/div>/);
  assert.match(html, /<div class="sidebar-menu-separator" role="separator"><\/div>/);

  const pin = html.match(/<button[^>]*>(?:(?!<\/button>).)*Pin(?:(?!<\/button>).)*<\/button>/)?.[0] ?? "";
  assert.match(pin, /role="menuitem"/);
  assert.match(pin, /tabindex="-1"/);
  assert.match(pin, /aria-keyshortcuts="P"/);
  assert.match(pin, /<kbd class="sidebar-menu-shortcut">P<\/kbd>/);
  assert.match(pin, /<span class="sidebar-menu-icon"><svg[^>]*aria-hidden="true"/);

  const main = html.match(/<button[^>]*aria-checked="true"[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.match(main, /role="menuitemradio"/);
  assert.match(main, /class="sidebar-menu-item is-choice is-checked"/);
  assert.match(main, /<span class="sidebar-menu-label is-mono">main<\/span>/);
  assert.match(main, /<span class="sidebar-menu-note">main<\/span>/);
  assert.match(main, /<path d="M20 6 9 17l-5-5"><\/path>/, "a checked choice shows the check mark");

  const feature = html.match(/<button[^>]*aria-checked="false"[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.match(feature, /role="menuitemradio"/);
  assert.match(feature, /<span class="sidebar-menu-icon"><\/span>/, "an unchecked choice keeps an empty slot");
  assert.match(feature, /title="\/work\/app-worktrees\/feature-x"/, "a tooltip shows what the label shortens");
  assert.doesNotMatch(main, /title=/);

  const archive = html.match(/<button[^>]*aria-disabled="true"[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.match(archive, /Archive/);
  assert.match(archive, /<span class="sidebar-menu-note">Running<\/span>/);
  assert.doesNotMatch(archive, /sidebar-menu-shortcut|aria-keyshortcuts/, "the reason replaces the shortcut");

  assert.match(html, /<button[^>]*class="sidebar-menu-item is-danger"[^>]*>.*?Delete…/);
  assert.equal((html.match(/data-sidebar-menu-item=""/g) ?? []).length, 5);
});

test("desktop width is configurable and a custom body is a dialog, not a menu", () => {
  const html = surface({ width: 240, children: h("form", null, h("input", { placeholder: "Branch name" })) });
  assert.match(html, /^<div class="sidebar-menu" role="dialog" aria-label="Session actions" style="width:240px">/);
  assert.match(html, /<form><input placeholder="Branch name"\/><\/form>/);
  assert.doesNotMatch(html, /role="menuitem"/);
});

test("the mobile sheet has its own backdrop, a title, the items and a Cancel button", () => {
  const html = surface({ sheet: true, title: "A very long session title" });
  assert.match(html, /^<div class="sidebar-sheet-layer"><div class="sidebar-sheet-backdrop" aria-hidden="true"><\/div>/);
  assert.match(html, /<div class="sidebar-sheet" role="dialog" aria-modal="true" aria-label="Session actions">/);
  assert.match(html, /<div class="sidebar-sheet-title">A very long session title<\/div>/);
  assert.match(html, /<div class="sidebar-sheet-body" role="menu" aria-label="Session actions">/);
  assert.match(html, /<button type="button" class="sidebar-sheet-cancel">Cancel<\/button><\/div><\/div>$/);
  assert.doesNotMatch(html, /style="width/, "the sheet is full width");

  const form = surface({ sheet: true, children: h("input", { "aria-label": "Branch" }) });
  assert.match(form, /<div class="sidebar-sheet-body"><input aria-label="Branch"\/><\/div>/);
  assert.doesNotMatch(form, /data-sidebar-menu-autofocus/, "the body's first control takes focus");
  // A question whose other answer discards something starts on the sheet's Cancel.
  const question = surface({ sheet: true, focusCancel: true, children: h("button", { type: "button" }, "Force") });
  assert.match(question, /<div class="sidebar-sheet-body"><button type="button">Force<\/button><\/div><button type="button" class="sidebar-sheet-cancel" data-sidebar-menu-autofocus="">Cancel<\/button>/);
});

test("conditional bodies that are all off are no body: the items show", () => {
  // `{a && <Form/>}{b && <Question/>}` with neither showing arrives as [false, false].
  for (const children of [undefined, null, false, [false, false], [null, undefined]]) {
    assert.equal(hasCustomMenuBody(children), false, JSON.stringify(children));
    const html = surface({ children });
    assert.match(html, /^<div class="sidebar-menu" role="menu"/);
    assert.equal((html.match(/data-sidebar-menu-item=""/g) ?? []).length, 5);
    const sheet = surface({ sheet: true, children });
    assert.match(sheet, /<div class="sidebar-sheet-body" role="menu" aria-label="Session actions">/);
  }
  assert.equal(hasCustomMenuBody([false, h("form")]), true);
  assert.match(surface({ children: [false, h("form", { key: "form" })] }), /^<div class="sidebar-menu" role="dialog"[^>]*><form><\/form><\/div>$/);
});

test("desktop placement: at a point, flipping like a native context menu, then clamped", () => {
  const viewport = { left: 0, top: 0, width: 1000, height: 800 };
  const size = { width: 200, height: 180 };
  assert.deepEqual(placeSidebarMenu({ kind: "point", x: 100, y: 120 }, size, viewport), { left: 100, top: 120 });
  assert.deepEqual(placeSidebarMenu({ kind: "point", x: 900, y: 700 }, size, viewport), { left: 700, top: 520 });
  // No room on either side: clamped 8px inside the viewport.
  assert.deepEqual(placeSidebarMenu({ kind: "point", x: 150, y: 100 }, size, { left: 0, top: 0, width: 300, height: 250 }), { left: 92, top: 62 });
  // The visual viewport may be scrolled or zoomed inside the layout viewport.
  assert.deepEqual(placeSidebarMenu({ kind: "point", x: 0, y: 0 }, size, { left: 40, top: 300, width: 400, height: 400 }), { left: 48, top: 308 });
});

test("desktop placement: below a button, aligned by edge, flipping above when it does not fit", () => {
  const viewport = { left: 0, top: 0, width: 1000, height: 800 };
  const size = { width: 208, height: 150 };
  const rect = { left: 220, top: 100, right: 242, bottom: 122 };
  assert.deepEqual(placeSidebarMenu({ kind: "rect", rect, align: "start" }, size, viewport), { left: 220, top: 126 });
  assert.deepEqual(placeSidebarMenu({ kind: "rect", rect, align: "end" }, size, viewport), { left: 34, top: 126 });
  const low = { left: 220, top: 700, right: 242, bottom: 722 };
  assert.deepEqual(placeSidebarMenu({ kind: "rect", rect: low, align: "end" }, size, viewport), { left: 34, top: 546 });
  // A button near the left edge with end alignment is clamped to the margin.
  const edge = { left: 10, top: 100, right: 32, bottom: 122 };
  assert.deepEqual(placeSidebarMenu({ kind: "rect", rect: edge, align: "end" }, size, viewport), { left: 8, top: 126 });
  // Too tall for either side: stays below, clamped to the bottom margin.
  const tall = { width: 208, height: 700 };
  assert.deepEqual(placeSidebarMenu({ kind: "rect", rect, align: "start" }, tall, viewport), { left: 220, top: 92 });
});

test("shortcut letters find enabled items, case-insensitively", () => {
  assert.equal(findSidebarMenuShortcut(items, "p")?.id, "pin");
  assert.equal(findSidebarMenuShortcut(items, "D")?.id, "delete");
  assert.equal(findSidebarMenuShortcut(items, "a"), null, "disabled items are not activated");
  assert.equal(findSidebarMenuShortcut(items, "x"), null);
  assert.equal(findSidebarMenuShortcut(items, "Enter"), null);
  assert.equal(findSidebarMenuShortcut(undefined, "p"), null);
});

/** A stand-in for an element: whether it is laid out, its row, and what it holds. */
function fakeElement({ rendered = true, connected = true, disabled = false, tabIndex = 0, children = [], row = null, filterField = false } = {}) {
  const element = {
    isConnected: connected,
    disabled,
    tabIndex,
    getAttribute: () => null,
    getClientRects: () => ({ length: rendered ? 1 : 0 }),
    closest: (selector) => (selector === "[data-row-key]" ? element.row : null),
    matches: (selector) => filterField && selector === "[data-sidebar-menu-filter]",
    querySelectorAll: () => children,
    focus() {},
    row,
  };
  return element;
}

test("focus never goes to an opener that is hidden: the row's own button takes it", () => {
  // A rendered opener (the selected row's ⋯, a phone's) gets focus back itself.
  const shown = fakeElement();
  assert.equal(menuFocusReturnTarget(shown), shown);

  // A row's ⋯ is display: none once its menu has closed (not hovered, not selected).
  const main = fakeElement();
  const hiddenMore = fakeElement({ rendered: false });
  const row = fakeElement({ children: [main, hiddenMore] });
  hiddenMore.row = row;
  assert.equal(menuFocusReturnTarget(hiddenMore), main);

  // A group's + and ⋯ hide with their container; disabled, untabbable and hidden controls are skipped.
  const toggle = fakeElement();
  const groupRow = fakeElement({ children: [fakeElement({ disabled: true }), fakeElement({ tabIndex: -1 }), fakeElement({ rendered: false }), toggle] });
  const groupMore = fakeElement({ rendered: false, row: groupRow });
  assert.equal(menuFocusReturnTarget(groupMore), toggle);

  // Nothing to focus: no opener, an opener gone from the page, a hidden one
  // outside a row, or a row that is hidden as a whole (the tab or view went away).
  assert.equal(menuFocusReturnTarget(null), null);
  assert.equal(menuFocusReturnTarget(fakeElement({ connected: false })), null);
  assert.equal(menuFocusReturnTarget(fakeElement({ rendered: false })), null);
  const hiddenRow = fakeElement({ children: [fakeElement({ rendered: false })] });
  assert.equal(menuFocusReturnTarget(fakeElement({ rendered: false, row: hiddenRow })), null);
});

test("a body swapped into an open menu takes the focus from a long list's filter field", () => {
  // Eight choices show a filter above the list, marked to take focus when the
  // menu opens. "New worktree…" then adds a form under the list whose branch
  // field is marked too — and comes after the filter in the page, so the
  // first marked control would stay the filter. The swap's own target is the
  // form's field.
  const filterField = fakeElement({ filterField: true });
  const branchField = fakeElement();
  assert.equal(menuBodyFocusTarget(fakeElement({ children: [filterField, branchField] })), branchField);

  // A hidden field cannot take it; with no other body marked, focus falls
  // back to the opening's target, the filter.
  assert.equal(menuBodyFocusTarget(fakeElement({ children: [filterField, fakeElement({ rendered: false })] })), filterField);
  assert.equal(menuBodyFocusTarget(fakeElement({ children: [filterField] })), filterField);
});

test("menu styles parse on Safari 16.2", () => {
  // Hand-written CSS must parse on Safari 16.2: no nesting.
  assert.doesNotMatch(css, /\{[^{}]*\{[^{}]*\}[^{}]*&/);
  assert.doesNotMatch(css, /@starting-style/);
});

test("icons are decorative unless labelled, and the spinner turns through a class", () => {
  const more = renderToStaticMarkup(h(MoreIcon));
  assert.match(more, /^<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">/);
  const spinner = renderToStaticMarkup(h(SpinnerIcon, { size: 12, label: "Agent running", className: "row-status" }));
  assert.match(spinner, /width="12"/);
  assert.match(spinner, /stroke-width="2\.8"/);
  assert.match(spinner, /class="sidebar-spin row-status"/);
  assert.match(spinner, /role="img" aria-label="Agent running"/);
  assert.doesNotMatch(spinner, /aria-hidden/);
  assert.match(spinner, /<path d="M21 12a9 9 0 1 1-3\.8-7\.4"><\/path>/);
});

const projectChoices = Array.from({ length: SIDEBAR_MENU_FILTER_MIN_CHOICES }, (_, index) => ({
  type: "item",
  id: `project:${index}`,
  label: index === 3 ? "pi-web" : `project-${index}`,
  note: index === 5 ? "Workspace" : undefined,
  title: `/home/me/${index === 6 ? "clients/acme" : `p${index}`}`,
  checked: index === 0,
  onSelect: noop,
}));
const projectMenu = [
  ...projectChoices,
  { type: "separator", id: "separator" },
  { type: "item", id: "open-folder", label: "Open another project…", onSelect: noop },
];
const filter = { placeholder: "Filter projects…", emptyLabel: "No matching projects" };

test("a filter shows once a menu has enough choices, and narrows only the choices", () => {
  assert.equal(SIDEBAR_MENU_FILTER_MIN_CHOICES, 8);
  assert.equal(sidebarMenuHasFilter(projectMenu), true);
  assert.equal(sidebarMenuHasFilter(projectMenu.slice(1)), false, "seven choices, and the actions do not count");
  assert.equal(sidebarMenuHasFilter(undefined), false);
  // By label, note or title, case-insensitive; separators and actions stay.
  const ids = (query) => filterSidebarMenuItems(projectMenu, query).map((item) => item.id);
  assert.deepEqual(ids("PI-WEB"), ["project:3", "separator", "open-folder"]);
  assert.deepEqual(ids("workspace"), ["project:5", "separator", "open-folder"]);
  assert.deepEqual(ids("acme"), ["project:6", "separator", "open-folder"]);
  assert.deepEqual(ids("  "), projectMenu.map((item) => item.id));
  assert.deepEqual(ids("nothing"), ["separator", "open-folder"]);
});

test("a classic menu: main's dropdown look, paths cut at their left, a footer and a row of its own", () => {
  const classicItems = [
    { type: "item", id: "app", label: "~/work/app", mono: true, path: true, title: "/home/me/work/app", checked: true, onSelect: noop },
    { type: "custom", id: "feature", content: h("div", { className: "question" }, h("button", { type: "button", "data-sidebar-menu-item": "" }, "Force")) },
    { type: "item", id: "default", label: "Use default directory", onSelect: noop },
  ];
  const html = surface({ classic: true, items: classicItems, footer: h("form", { className: "footer" }, "New worktree") });
  // A footer stands after the list, so the surface is a dialog holding a menu.
  assert.match(html, /^<div class="sidebar-menu is-classic" role="dialog" aria-label="Session actions"[^>]*><div role="menu" aria-label="Session actions">/);
  assert.match(html, /<\/div><form class="footer">New worktree<\/form><\/div>$/);
  // A path is cut at its left, the text kept left to right.
  assert.match(html, /<span class="sidebar-menu-label is-mono is-path"><span>~\/work\/app<\/span><\/span>/);
  // A custom entry shows as given, in its place.
  assert.match(html, /<div class="sidebar-menu-custom" role="none"><div class="question"><button type="button" data-sidebar-menu-item="">Force<\/button><\/div><\/div>/);
  // Without a footer a classic menu is a plain menu; a sheet never takes the look.
  assert.match(surface({ classic: true }), /^<div class="sidebar-menu is-classic" role="menu"/);
  assert.doesNotMatch(surface({ classic: true, sheet: true }), /is-classic/);
  // A filter may ask for more choices.
  assert.equal(sidebarMenuHasFilter(projectMenu, 9), false);
  assert.equal(sidebarMenuHasFilter([...projectMenu, { ...projectChoices[0], id: "ninth" }], 9), true);
});

test("filter markup: a field above the list, the empty label, focus only on a desktop", () => {
  // A menu holds only items: the field and the empty label stand before it, in a dialog.
  const html = surface({ items: projectMenu, filter, filterQuery: "" });
  assert.match(html, /^<div class="sidebar-menu" role="dialog" aria-label="Session actions" style="width:208px"><div class="sidebar-menu-filter"><input class="sidebar-menu-filter-input" placeholder="Filter projects…" aria-label="Filter projects…" [^>]*data-sidebar-menu-filter="" data-sidebar-menu-autofocus="" value=""\/><\/div><div role="status"><\/div><div role="menu" aria-label="Session actions"><button/);
  assert.equal((html.match(/role="menu"/g) ?? []).length, 1);
  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, 8);
  const narrowed = surface({ items: projectMenu, filter, filterQuery: "pi-web" });
  assert.equal((narrowed.match(/role="menuitemradio"/g) ?? []).length, 1);
  assert.match(narrowed, /Open another project…/);
  assert.doesNotMatch(narrowed, /sidebar-menu-empty/);
  const none = surface({ items: projectMenu, filter, filterQuery: "nothing" });
  assert.match(none, /<\/div><div role="status"><div class="sidebar-menu-empty">No matching projects<\/div><\/div><div role="menu" aria-label="Session actions"><div class="sidebar-menu-separator" role="separator"><\/div>/);
  // A phone's keyboard would cover the sheet: the field waits for a tap. The sheet is the dialog.
  const sheet = surface({ sheet: true, items: projectMenu, filter, filterQuery: "" });
  assert.match(sheet, /<div class="sidebar-sheet-body"><div class="sidebar-menu-filter"><input [^>]*data-sidebar-menu-filter="" value=""\/><\/div><div role="status"><\/div><div role="menu" aria-label="Session actions"><button/);
  // Too few choices, or a custom body: no field.
  assert.doesNotMatch(surface({ items: projectMenu.slice(1), filter }), /sidebar-menu-filter/);
  assert.doesNotMatch(surface({ items: projectMenu, filter, children: h("input") }), /sidebar-menu-filter/);
  // A footer form under a filtered list is marked too, after the filter in
  // the page: when it swaps in, its own field takes the focus
  // (menuBodyFocusTarget), not the filter above the list.
  const form = surface({ classic: true, items: projectMenu, filter, footer: h("input", { className: "sidebar-worktree-input", "data-sidebar-menu-autofocus": "" }) });
  assert.equal((form.match(/data-sidebar-menu-autofocus=""/g) ?? []).length, 2);
  assert.match(form, /data-sidebar-menu-filter="" data-sidebar-menu-autofocus=""[\s\S]*sidebar-worktree-input" data-sidebar-menu-autofocus=""/);
});

test("an item's secondary action is its own menu item at the row's end; a badge sits before the note", () => {
  const removeItems = [
    {
      type: "item",
      id: "feature",
      label: "feature/x",
      checked: false,
      title: "/work/app-worktrees/feature-x",
      secondary: { label: "Remove worktree checkout /work/app-worktrees/feature-x", icon: h(TrashIcon, { size: 12 }), danger: true, onSelect: noop },
      onSelect: noop,
    },
    {
      type: "item",
      id: "busy",
      label: "busy",
      checked: false,
      secondary: { label: "Remove busy", icon: h(TrashIcon, { size: 12 }), disabled: true, onSelect: noop },
      onSelect: noop,
    },
    { type: "item", id: "app", label: "app", checked: true, note: "Workspace", badge: h("span", { className: "badge" }, "2"), onSelect: noop },
  ];
  const html = surface({ items: removeItems });
  assert.match(html, /<div class="sidebar-menu-row is-choice" role="none"><button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" title="\/work\/app-worktrees\/feature-x" data-sidebar-menu-item="" class="sidebar-menu-item is-choice">[\s\S]*?<\/button><button type="button" role="menuitem" aria-label="Remove worktree checkout \/work\/app-worktrees\/feature-x" tabindex="-1" title="Remove worktree checkout \/work\/app-worktrees\/feature-x" data-sidebar-menu-item="" class="sidebar-menu-secondary is-danger"><svg/);
  assert.match(html, /aria-label="Remove busy" aria-disabled="true" tabindex="-1"[^>]*class="sidebar-menu-secondary"/);
  // Arrow keys reach both: each is a data-sidebar-menu-item.
  assert.equal((html.match(/data-sidebar-menu-item=""/g) ?? []).length, 5);
  assert.match(html, /<span class="sidebar-menu-label">app<\/span><span class="badge">2<\/span><span class="sidebar-menu-note">Workspace<\/span>/);
});
