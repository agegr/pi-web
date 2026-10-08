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
  filterSidebarMenuItems,
  sidebarMenuHasFilter,
  hasCustomMenuBody,
  SIDEBAR_MENU_FILTER_MIN_CHOICES,
} = await jiti.import("./SidebarMenu.tsx");
const { SpinnerIcon, MoreIcon, PinIcon, TrashIcon } = await jiti.import("./SidebarIcons.tsx");
const source = await readFile(new URL("./SidebarMenu.tsx", import.meta.url), "utf8");
const iconSource = await readFile(new URL("./SidebarIcons.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/sidebar-menu.css", import.meta.url), "utf8");

const h = React.createElement;

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
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
  assert.match(source, /const \[portalTarget, setPortalTarget\] = useState<HTMLElement \| null>\(null\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*setPortalTarget\(document\.body\);\s*\}, \[\]\);/);
  assert.match(source, /return createPortal\(\s*<SidebarMenuSurface[\s\S]*?portalTarget,\s*\);/);
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
  assert.match(source, /const custom = hasCustomMenuBody\(children\);[\s\S]*const custom = hasCustomMenuBody\(children\);/, "the surface and the menu decide alike");
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

test("Escape is taken in the capture phase and marked handled, so it never also stops the agent", () => {
  assert.match(source, /document\.addEventListener\("keydown", onKeyDown, true\);/);
  assert.match(source, /document\.removeEventListener\("keydown", onKeyDown, true\);/);
  assert.match(source, /if \(!surface \|\| event\.isComposing \|\| event\.keyCode === 229\) return;/);
  assert.match(source, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);[\s\S]*?onCloseRef\.current\("escape"\);\s*return;\s*\}/);
  // Arrow keys and shortcut letters are not stolen from a text field inside the menu.
  assert.match(source, /if \(inside && isTextEntry\(target\) && !leavesFilter\) return;/);
  const arrows = 'if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {';
  assert.ok(source.indexOf("isTextEntry(target) && !leavesFilter) return;") < source.indexOf(arrows));
  assert.ok(source.indexOf(arrows) < source.indexOf("findSidebarMenuShortcut(itemsRef.current, event.key)"));
  assert.match(source, /if \(event\.key\.length !== 1 \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return;/);
  // Enter on an item keeps Shift (Delete skips its confirmation) and ignores IME.
  assert.match(source, /if \(event\.key !== "Enter" \|\| event\.nativeEvent\.isComposing \|\| event\.keyCode === 229\) return;\s*event\.preventDefault\(\);\s*onActivate\(action, event\.shiftKey\);/);
  assert.match(source, /onKeyDown=\{activateOnEnter\(item, onActivate\)\}/);
  assert.match(source, /onKeyDown=\{activateOnEnter\(secondary, onActivate\)\}/);
});

test("an outside press closes a desktop menu in the capture phase without swallowing it", () => {
  assert.match(source, /document\.addEventListener\("pointerdown", onPointerDown, true\);/);
  const handler = source.slice(source.indexOf("const onPointerDown"), source.indexOf('document.addEventListener("pointerdown"'));
  assert.match(handler, /if \(!surface \|\| \(target && surface\.contains\(target\)\)\) return;/);
  assert.match(handler, /onCloseRef\.current\("outside"\);/);
  assert.doesNotMatch(handler, /preventDefault|stopPropagation/);
  assert.match(source, /if \(!visible \|\| sheet\) return;\s*const onPointerDown/);
});

test("activation calls onSelect before closing, and portal events stop at the menu", () => {
  assert.match(source, /item\.onSelect\(\{ shiftKey, keepOpen: \(\) => \{ keepOpen = true; \} \}\);\s*if \(!keepOpen\) onCloseRef\.current\("select"\);/);
  assert.match(source, /if \(item\.disabled\) return;/);
  assert.match(source, /<div className="sidebar-sheet-backdrop" aria-hidden="true" onClick=\{\(\) => onClose\("outside"\)\} \/>/);
  assert.match(source, /onClick=\{\(\) => onClose\("cancel"\)\}/);
  assert.match(source, /onClick: stopReactPropagation,/);
  assert.match(source, /onContextMenu: stopContextMenu,/);
  assert.equal((source.match(/\{\.\.\.isolateEvents\}/g) ?? []).length, 2);
});

test("focus moves into the menu on open and back to the opener on close", () => {
  assert.match(source, /initialFocusTarget\(surface\)\?\.focus\(\{ preventScroll: true \}\);/);
  // The opener is read when the menu opens: the parent closes the menu by
  // dropping its state, returnFocusTo included, before the cleanup runs.
  const restore = source.slice(source.indexOf("// On close, focus returns"), source.indexOf("// Keys, in the capture phase"));
  assert.match(restore, /if \(!visible \|\| !surface\) return;\s*const opener = returnFocusToRef\.current;\s*return \(\) => \{/);
  assert.doesNotMatch(restore.slice(restore.indexOf("return () => {")), /returnFocusToRef/);
  assert.match(restore, /if \(active && active !== document\.body && !surface\.contains\(active\)\) return;\s*const target = menuFocusReturnTarget\(opener\);\s*if \(!target\) return;\s*target\.focus\(\{ preventScroll: true \}\);/);
  assert.match(restore, /if \(opener && target !== opener && isRendered\(opener\)\) opener\.focus\(\{ preventScroll: true \}\);/);
});

/** A stand-in for an element: whether it is laid out, its row, and what it holds. */
function fakeElement({ rendered = true, connected = true, disabled = false, tabIndex = 0, children = [], row = null } = {}) {
  const element = {
    isConnected: connected,
    disabled,
    tabIndex,
    getAttribute: () => null,
    getClientRects: () => ({ length: rendered ? 1 : 0 }),
    closest: (selector) => (selector === "[data-row-key]" ? element.row : null),
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

test("menu, sheet and toast styles: layers above the drawer, reduced motion", () => {
  assert.match(cssRule(".sidebar-menu"), /position: fixed;[\s\S]*z-index: 400;[\s\S]*border-radius: 8px;[\s\S]*box-shadow: 0 6px 20px rgba\(0, 0, 0, 0\.10\);/);
  assert.match(cssRule(".sidebar-sheet-backdrop"), /position: fixed;\s*inset: 0;/);
  assert.match(cssRule(".sidebar-sheet"), /position: relative;\s*z-index: 1;[\s\S]*padding: 4px 0 max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*border-radius: 12px 12px 0 0;/);
  // The sheet sits at the bottom of the visible area, which the software
  // keyboard shrinks (iOS keeps the layout viewport, and bottom: 0, under it),
  // and drops the home indicator inset the keyboard covers.
  assert.match(cssRule(".sidebar-sheet-layer"), /position: fixed;\s*top: 0;\s*right: 0;\s*left: 0;\s*z-index: 410;\s*display: flex;\s*flex-direction: column;\s*justify-content: flex-end;\s*height: var\(--app-viewport-height, 100dvh\);/);
  assert.doesNotMatch(cssRule(".sidebar-sheet"), /position: fixed|bottom: 0/);
  assert.match(cssRule("html[data-keyboard-open] .sidebar-sheet"), /padding-bottom: 8px;/);
  assert.match(cssRule(".sidebar-menu-item"), /height: 28px;/);
  assert.match(cssRule(".sidebar-sheet .sidebar-menu-item"), /height: 48px;[\s\S]*font-size: 15px;/);
  assert.match(cssRule(".sidebar-sheet .sidebar-menu-shortcut"), /display: none;/);
  assert.match(cssRule(".sidebar-spin"), /animation: spin 0\.9s linear infinite;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.sidebar-spin,\s*\.sidebar-menu,\s*\.sidebar-sheet,\s*\.sidebar-sheet-backdrop,\s*\.sidebar-toast \{\s*animation: none;/);
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
  for (const name of ["PlusIcon", "MoreIcon", "ArchiveIcon", "RestoreIcon", "PinIcon", "PinOffIcon", "ChevronIcon", "BranchIcon", "ForkIcon", "TrashIcon", "PencilIcon", "DotIcon", "DotOutlineIcon", "CheckIcon", "FolderIcon", "FolderPlusIcon", "TerminalIcon", "SearchIcon", "UploadIcon", "RefreshIcon", "ChangesIcon", "MessageIcon", "SpinnerIcon"]) {
    assert.match(iconSource, new RegExp(`export function ${name}\\(`), `${name} is exported`);
  }
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
  // Main's dropdowns: rows divided by lines, 11px, a 10px check, no inner padding.
  assert.match(cssRule(".sidebar-menu.is-classic"), /^\s*padding: 0;\s*$/);
  assert.match(cssRule(".sidebar-menu.is-classic .sidebar-menu-item"), /gap: 7px;\s*height: auto;\s*padding: 8px 10px;\s*border-radius: 0;\s*color: var\(--text-muted\);\s*font-size: 11px;/);
  assert.match(css, /\.sidebar-menu\.is-classic \.sidebar-menu-item\.is-choice,\s*\.sidebar-menu\.is-classic \.sidebar-menu-row\.is-choice \{\s*border-bottom: 1px solid var\(--border\);/);
  assert.match(cssRule(".sidebar-menu.is-classic .sidebar-menu-icon svg"), /width: 10px;\s*height: 10px;/);
  assert.match(cssRule(".sidebar-menu-label.is-path"), /direction: rtl;\s*text-align: left;/);
  // A dirty checkout's question in its row: red-tinted, its two buttons small.
  assert.match(cssRule(".sidebar-worktree-confirm"), /padding: 7px 10px;\s*border-bottom: 1px solid var\(--border\);\s*background: rgba\(239, 68, 68, 0\.06\);/);
  // Focus goes in again when the body changes, and a filter may ask for more choices.
  assert.match(source, /\}, \[visible, sheet, custom, focusKey\]\);/);
  assert.equal(sidebarMenuHasFilter(projectMenu, 9), false);
  assert.equal(sidebarMenuHasFilter([...projectMenu, { ...projectChoices[0], id: "ninth" }], 9), true);
  assert.match(source, /sidebarMenuHasFilter\(items, filter\.minChoices\)/);
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
});

test("filter keys: Up and Down leave the field, Escape clears it before it closes, IME is left alone", () => {
  assert.match(source, /const leavesFilter = \(event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"\) && target\?\.matches\(FILTER_SELECTOR\);\s*if \(inside && isTextEntry\(target\) && !leavesFilter\) return;/);
  const escape = source.slice(source.indexOf('if (event.key === "Escape") {'), source.indexOf("const target = event.target instanceof Element"));
  assert.match(escape, /const field = surface\.querySelector<HTMLElement>\(FILTER_SELECTOR\);\s*if \(field && filterQueryRef\.current\) \{\s*setFilterQuery\(""\);\s*field\.focus\(\{ preventScroll: true \}\);\s*return;\s*\}\s*onCloseRef\.current\("escape"\);/);
  // The capture listener already returns for composition before any of this.
  assert.ok(source.indexOf("if (!surface || event.isComposing || event.keyCode === 229) return;") < source.indexOf("const field = surface.querySelector"));
  // Each opening, and each body, starts with an empty field.
  assert.match(source, /useEffect\(\(\) => \{\s*setFilterQuery\(""\);\s*\}, \[visible, custom\]\);/);
  // A marked control takes the focus first: the filter, or a confirmation's Cancel.
  assert.match(source, /const marked = Array\.from\(surface\.querySelectorAll<HTMLElement>\(AUTOFOCUS_SELECTOR\)\)\.find\(isFocusable\);\s*if \(marked\) return marked;/);
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
  // A disabled secondary does nothing: activation checks it like any item.
  assert.match(source, /const activate = \(item: MenuAction, shiftKey: boolean\) => \{\s*if \(item\.disabled\) return;/);
});

test("filter and secondary action styles: sticky field, room for a finger, a capped height", () => {
  assert.match(cssRule(".sidebar-menu"), /max-height: min\(calc\(var\(--app-viewport-height, 100dvh\) - 16px\), 480px\);/);
  // Sticky insets count from inside the scroller's padding (4px, the sheet's too): -4px is its edge.
  assert.match(cssRule(".sidebar-menu-filter"), /position: sticky;\s*top: -4px;/);
  assert.match(cssRule(".sidebar-menu-row > .sidebar-menu-item"), /flex: 1;\s*min-width: 0;/);
  assert.match(cssRule(".sidebar-menu-secondary"), /width: 28px;\s*height: 28px;/);
  assert.match(cssRule(".sidebar-sheet .sidebar-menu-secondary"), /width: 48px;\s*height: 48px;/);
  assert.match(css, /\.sidebar-menu-secondary\.is-danger:not\(\[aria-disabled="true"\]\):hover,\s*\.sidebar-menu-secondary\.is-danger:focus-visible \{\s*background: rgba\(239, 68, 68, 0\.08\);\s*color: #ef4444;/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.sidebar-menu-item \{\s*height: 40px;\s*\}[\s\S]*?\.sidebar-menu-secondary \{\s*width: 40px;\s*height: 40px;/);
});
