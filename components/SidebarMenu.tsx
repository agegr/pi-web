"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./SidebarIcons";

/**
 * The session sidebar's popup menu: a row's ⋯ or right-click menu, a project
 * group's menu; also the project and worktree menus of the files tab and of
 * the bar above a fresh composer (components/ProjectWorktreePicker.tsx). On a
 * desktop it is a small menu placed at a point or beside a button; on a phone
 * (`sheet`) a bottom sheet over its own backdrop. Either way it is portaled to `document.body`: the mobile sidebar
 * drawer moves with `transform`, which would make a `position: fixed` menu
 * inside it fixed to the 280px drawer instead of the screen.
 *
 * What it shows and whether it is open come from the parent, which keeps
 * them above the virtualized rows so a row scrolled out of view does not
 * take its open menu with it; the menu keeps only its filter field's text.
 */

/** What an item's `onSelect` is told about the activation. */
export interface SidebarMenuSelectEvent {
  /** Shift was held (click, Enter or the item's shortcut letter): Delete skips its confirmation. */
  shiftKey: boolean;
  /**
   * Leaves the menu open instead of closing it after `onSelect`: for an item
   * that swaps the menu's body, such as "New worktree…" turning the worktree
   * menu into a small form.
   */
  keepOpen(): void;
}

/** An icon button at the end of an item's row with an action of its own (a worktree's remove). */
export interface SidebarMenuSecondaryAction {
  /** Its accessible name and tooltip. */
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: (event: SidebarMenuSelectEvent) => void;
}

export type SidebarMenuItem =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      /** One letter that activates the item while the menu has focus. */
      shortcut?: string;
      /** Right-aligned hint shown instead of the shortcut (a worktree's "main"). */
      note?: string;
      /** Tooltip: what the label shortens (a project's full path). */
      title?: string;
      /** A choice: shows a check mark (true) or an empty slot (false) instead of `icon`. */
      checked?: boolean;
      mono?: boolean;
      /** A path (or a branch): cut at its left, where it differs least. */
      path?: boolean;
      danger?: boolean;
      disabled?: boolean;
      /** Shown on the right of a disabled item, in place of its shortcut. */
      disabledReason?: string;
      /** Shown before the note: a project's running and unread counts. */
      badge?: ReactNode;
      /** Arrow keys reach it right after its item. */
      secondary?: SidebarMenuSecondaryAction;
      onSelect: (event: SidebarMenuSelectEvent) => void;
    }
  | { type: "separator"; id: string }
  | { type: "header"; id: string; label: string }
  /** Shown as given in the item's place (a classic menu's confirmation row); its buttons mark themselves as items. */
  | { type: "custom"; id: string; content: ReactNode };

export type SidebarMenuAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; rect: { left: number; top: number; right: number; bottom: number }; align: "start" | "end" };

export type SidebarMenuCloseReason = "escape" | "outside" | "select" | "cancel";

/**
 * A field above the items that narrows the menu's choices (the items with
 * `checked`) by label, note and title, shown once there are
 * `SIDEBAR_MENU_FILTER_MIN_CHOICES` of them. Other items (an action such as
 * "New worktree…") always show.
 */
export interface SidebarMenuFilter {
  placeholder: string;
  /** Shown when no choice matches. */
  emptyLabel: string;
  /** Choices needed for the field, if not `SIDEBAR_MENU_FILTER_MIN_CHOICES` (a classic project menu's 9, as on main). */
  minChoices?: number;
}

export const SIDEBAR_MENU_FILTER_MIN_CHOICES = 8;

export interface SidebarMenuProps {
  open: boolean;
  anchor: SidebarMenuAnchor | null;
  /** True on a phone (≤640px): a bottom sheet with its own backdrop. */
  sheet: boolean;
  ariaLabel: string;
  /** The sheet's heading (one line, ellipsis). */
  title?: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** A custom body (a small form) instead of `items`. */
  children?: ReactNode;
  /** The sheet's Cancel button. */
  cancelLabel: string;
  /**
   * The sheet's Cancel takes focus when the menu opens or its body changes:
   * for a question whose other answer discards something (force-removing a
   * checkout), so Enter must not give it. On a desktop the body marks its own
   * Cancel instead.
   */
  focusCancel?: boolean;
  /** Tab out of the menu reports "outside". */
  onClose: (reason: SidebarMenuCloseReason) => void;
  /**
   * Focus goes back here on close when it was inside the menu or fell to
   * `<body>`. Read when the menu opens: the parent may let go of it before
   * the menu has closed.
   */
  returnFocusTo?: HTMLElement | null;
  /** Desktop width in px. */
  width?: number;
  /**
   * The files tab's project and worktree menus on a desktop: the look of the
   * dropdowns they were on main, rows divided by lines, 11px.
   */
  classic?: boolean;
  /** Shown after the items, outside the list (a classic worktree menu's "New worktree…" form). */
  footer?: ReactNode;
  /** Focus goes into the menu again whenever this changes (a body swapped in or out). */
  focusKey?: string;
}

type ActionItem = Extract<SidebarMenuItem, { type: "item" }>;
/** What activating an item or its secondary action needs. */
type MenuAction = Pick<ActionItem, "disabled" | "onSelect">;

/** Distance the menu keeps from the edges of the visible viewport. */
const MENU_MARGIN = 8;
/** Gap between a button and the menu it opened. */
const ANCHOR_GAP = 4;
const DEFAULT_MENU_WIDTH = 208;

const ITEM_SELECTOR = "[data-sidebar-menu-item]";
const FILTER_SELECTOR = "[data-sidebar-menu-filter]";
/** The control that takes focus when the menu or its body shows (the filter, a confirmation's Cancel, the sheet's for `focusCancel`). */
const AUTOFOCUS_SELECTOR = "[data-sidebar-menu-autofocus]";
const FOCUSABLE_SELECTOR = "button, input, textarea, select, a[href], [tabindex]";
/** A row of the session tree (components/SessionTree.tsx), where most openers sit. */
const ROW_SELECTOR = "[data-row-key]";

export interface SidebarMenuViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a desktop menu of `size` goes, in viewport coordinates. A point (a
 * right-click) opens the menu at the pointer, to its left or above it when it
 * does not fit, like a native context menu. A button's rect opens it below,
 * lined up with the button's left (`start`) or right (`end`) edge, and above
 * the button when there is no room below but there is above. Whatever is left
 * over is clamped into the viewport, `MENU_MARGIN` from its edges.
 */
export function placeSidebarMenu(
  anchor: SidebarMenuAnchor,
  size: { width: number; height: number },
  viewport: SidebarMenuViewport,
  margin = MENU_MARGIN,
): { left: number; top: number } {
  const minLeft = viewport.left + margin;
  const minTop = viewport.top + margin;
  const maxRight = viewport.left + viewport.width - margin;
  const maxBottom = viewport.top + viewport.height - margin;
  let left: number;
  let top: number;
  if (anchor.kind === "point") {
    left = anchor.x + size.width > maxRight && anchor.x - size.width >= minLeft ? anchor.x - size.width : anchor.x;
    top = anchor.y + size.height > maxBottom && anchor.y - size.height >= minTop ? anchor.y - size.height : anchor.y;
  } else {
    const { rect } = anchor;
    left = anchor.align === "end" ? rect.right - size.width : rect.left;
    const below = rect.bottom + ANCHOR_GAP;
    const above = rect.top - ANCHOR_GAP - size.height;
    top = below + size.height > maxBottom && above >= minTop ? above : below;
  }
  return {
    left: Math.max(minLeft, Math.min(left, maxRight - size.width)),
    top: Math.max(minTop, Math.min(top, maxBottom - size.height)),
  };
}

/**
 * The enabled item a typed letter activates: its `shortcut`, case-insensitive
 * (Shift+D still means D, and tells Delete to skip its confirmation).
 */
export function findSidebarMenuShortcut(items: readonly SidebarMenuItem[] | undefined, key: string): ActionItem | null {
  if (!items || key.length !== 1) return null;
  const wanted = key.toLowerCase();
  for (const item of items) {
    if (item.type === "item" && !item.disabled && item.shortcut && item.shortcut.toLowerCase() === wanted) return item;
  }
  return null;
}

/**
 * Whether `children` is a custom body. Two conditional bodies side by side
 * arrive as an array (`[false, false]` while neither shows), which is no body.
 */
export function hasCustomMenuBody(children: ReactNode): boolean {
  return Children.toArray(children).length > 0;
}

function isChoice(item: SidebarMenuItem): boolean {
  return item.type === "item" && item.checked !== undefined;
}

/** Whether `items` have enough choices for a filter field. */
export function sidebarMenuHasFilter(items: readonly SidebarMenuItem[] | undefined, minChoices = SIDEBAR_MENU_FILTER_MIN_CHOICES): boolean {
  return (items ?? []).filter(isChoice).length >= minChoices;
}

/**
 * The items a filter `query` leaves: the choices whose label, note or title
 * contains it (case-insensitive), and every item that is not a choice.
 */
export function filterSidebarMenuItems(items: readonly SidebarMenuItem[], query: string): SidebarMenuItem[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...items];
  return items.filter((item) => item.type !== "item" || item.checked === undefined
    || [item.label, item.note, item.title].some((text) => text?.toLowerCase().includes(wanted)));
}

/** A field the keys belong to: arrows move its caret, letters are typed into it. */
function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if ((element as HTMLElement).isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = ((element as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "reset", "submit", "image", "color", "file"].includes(type);
}

/** Laid out: not display: none itself or inside something that is. Only such an element takes focus. */
function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function isFocusable(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  return isRendered(element);
}

/**
 * Where focus goes back to when a menu closes: its opener, while it is on the
 * page and rendered. A tree row's ⋯ (a group's + and ⋯ too) shows only while
 * the row is hovered, selected, holds keyboard focus or has its menu open, so
 * once the menu has closed it can be display: none, and focus() on it would
 * do nothing: focus would fall to `<body>`. The first control of the opener's
 * row that can take focus (its main button, a group's toggle) does instead.
 */
export function menuFocusReturnTarget(opener: HTMLElement | null): HTMLElement | null {
  if (!opener || !opener.isConnected) return null;
  if (isRendered(opener)) return opener;
  const row = opener.closest(ROW_SELECTOR);
  if (!row) return null;
  for (const control of Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
    if (control.tabIndex >= 0 && isFocusable(control)) return control;
  }
  return null;
}

function enabledItems(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(isFocusable);
}

/**
 * What focus goes to when the menu opens: a control marked to take it (a
 * filter field, a confirmation's Cancel), else the first enabled item, else
 * the custom body's first control.
 */
function initialFocusTarget(surface: HTMLElement): HTMLElement | null {
  const marked = Array.from(surface.querySelectorAll<HTMLElement>(AUTOFOCUS_SELECTOR)).find(isFocusable);
  if (marked) return marked;
  const items = enabledItems(surface);
  if (items.length > 0) return items[0];
  const controls = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && isFocusable(element));
  return controls[0] ?? null;
}

/**
 * Whether Tab (or Shift+Tab) from `active` takes focus out of the menu: no
 * tabbable element of the menu follows it (precedes it). Items themselves are
 * not tabbable (arrows move between them), so Tab from an item leaves a plain
 * menu, while a form inside one (or the sheet's Cancel) keeps its own order.
 */
function tabLeavesSurface(surface: HTMLElement, active: Element, backwards: boolean): boolean {
  const tabbables = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element !== active && element.tabIndex >= 0 && isFocusable(element));
  const direction = backwards ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  return !tabbables.some((element) => (active.compareDocumentPosition(element) & direction) !== 0);
}

/**
 * The opener was pressed while its menu was open: that press closed the menu,
 * and its click must not open it again. Without this a second click on ⋯
 * would close and reopen the menu instead of closing it.
 */
function swallowNextClickOn(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  let timer = 0;
  const stop = () => {
    doc.removeEventListener("click", onClick, true);
    view.clearTimeout(timer);
  };
  function onClick(event: MouseEvent) {
    stop();
    if (!(event.target instanceof Node) || !element.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }
  doc.addEventListener("click", onClick, true);
  timer = view.setTimeout(stop, 1000);
}

/**
 * The portal is outside the sidebar in the page, but React still bubbles its
 * events to the components that rendered it: a click on an item would reach
 * the session row underneath in the component tree and select it. Events stop
 * at the menu.
 */
function stopReactPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function stopContextMenu(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

const isolateEvents = {
  onClick: stopReactPropagation,
  onDoubleClick: stopReactPropagation,
  onMouseDown: stopReactPropagation,
  onMouseUp: stopReactPropagation,
  onPointerDown: stopReactPropagation,
  onPointerUp: stopReactPropagation,
  onKeyDown: stopReactPropagation,
  onKeyUp: stopReactPropagation,
  onFocus: stopReactPropagation,
  onBlur: stopReactPropagation,
  onContextMenu: stopContextMenu,
};

export interface SidebarMenuSurfaceProps {
  sheet: boolean;
  ariaLabel: string;
  title?: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** The filter field's text. */
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  children?: ReactNode;
  cancelLabel: string;
  focusCancel?: boolean;
  width?: number;
  classic?: boolean;
  footer?: ReactNode;
  surfaceRef?: Ref<HTMLDivElement>;
  onActivate: (action: MenuAction, shiftKey: boolean) => void;
  onClose: (reason: "outside" | "cancel") => void;
}

/**
 * Enter is taken on the button rather than left to its click, which would
 * not say whether Shift was held.
 */
function activateOnEnter(action: MenuAction, onActivate: SidebarMenuSurfaceProps["onActivate"]) {
  return (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    onActivate(action, event.shiftKey);
  };
}

function MenuItemButton({ item, onActivate }: { item: ActionItem; onActivate: SidebarMenuSurfaceProps["onActivate"] }) {
  const choice = item.checked !== undefined;
  const className = [
    "sidebar-menu-item",
    choice ? "is-choice" : "",
    item.danger ? "is-danger" : "",
    item.checked ? "is-checked" : "",
  ].filter(Boolean).join(" ");
  const labelClassName = ["sidebar-menu-label", item.mono ? "is-mono" : "", item.path ? "is-path" : ""].filter(Boolean).join(" ");
  let trailing: ReactNode = null;
  if (item.disabled && item.disabledReason) {
    trailing = <span className="sidebar-menu-note">{item.disabledReason}</span>;
  } else if (item.note) {
    trailing = <span className="sidebar-menu-note">{item.note}</span>;
  } else if (item.shortcut) {
    trailing = <kbd className="sidebar-menu-shortcut">{item.shortcut}</kbd>;
  }
  const button = (
    <button
      type="button"
      role={choice ? "menuitemradio" : "menuitem"}
      aria-checked={choice ? item.checked : undefined}
      aria-disabled={item.disabled ? true : undefined}
      aria-keyshortcuts={item.shortcut && !item.disabled ? item.shortcut.toUpperCase() : undefined}
      tabIndex={-1}
      title={item.title}
      data-sidebar-menu-item=""
      className={className}
      onClick={(event) => onActivate(item, event.shiftKey)}
      onKeyDown={activateOnEnter(item, onActivate)}
    >
      <span className="sidebar-menu-icon">
        {choice ? (item.checked ? <CheckIcon size={13} /> : null) : item.icon}
      </span>
      <span className={labelClassName}>{item.path ? <span>{item.label}</span> : item.label}</span>
      {item.badge}
      {trailing}
    </button>
  );
  const secondary = item.secondary;
  if (!secondary) return button;
  return (
    <div className={choice ? "sidebar-menu-row is-choice" : "sidebar-menu-row"} role="none">
      {button}
      <button
        type="button"
        role="menuitem"
        aria-label={secondary.label}
        aria-disabled={secondary.disabled ? true : undefined}
        tabIndex={-1}
        title={secondary.label}
        data-sidebar-menu-item=""
        className={secondary.danger ? "sidebar-menu-secondary is-danger" : "sidebar-menu-secondary"}
        onClick={(event) => onActivate(secondary, event.shiftKey)}
        onKeyDown={activateOnEnter(secondary, onActivate)}
      >
        {secondary.icon}
      </button>
    </div>
  );
}

/**
 * The menu or sheet itself, without the portal, placement, focus or key
 * handling `SidebarMenu` adds around it.
 */
export function SidebarMenuSurface({
  sheet,
  ariaLabel,
  title,
  items,
  filter,
  filterQuery = "",
  onFilterQueryChange,
  children,
  cancelLabel,
  focusCancel = false,
  width = DEFAULT_MENU_WIDTH,
  classic = false,
  footer,
  surfaceRef,
  onActivate,
  onClose,
}: SidebarMenuSurfaceProps) {
  const custom = hasCustomMenuBody(children);
  const hasFooter = !custom && hasCustomMenuBody(footer);
  const filtered = filter !== undefined && !custom && sidebarMenuHasFilter(items, filter.minChoices);
  const shown = filtered ? filterSidebarMenuItems(items ?? [], filterQuery) : items ?? [];
  const list = shown.map((item) => {
    if (item.type === "separator") return <div key={item.id} className="sidebar-menu-separator" role="separator" />;
    if (item.type === "header") return <div key={item.id} className="sidebar-menu-header" role="presentation">{item.label}</div>;
    if (item.type === "custom") return <div key={item.id} className="sidebar-menu-custom" role="none">{item.content}</div>;
    return <MenuItemButton key={item.id} item={item} onActivate={onActivate} />;
  });
  // A menu holds only its items: the field and what it found stand before
  // the list, a footer after it, inside a dialog (the sheet is one already).
  const body = custom ? children : filtered || hasFooter ? (
    <>
      {/* On a phone the field takes no focus by itself: the keyboard would cover the sheet. */}
      {filtered && (
        <div className="sidebar-menu-filter">
          <input
            className="sidebar-menu-filter-input"
            value={filterQuery}
            placeholder={filter.placeholder}
            aria-label={filter.placeholder}
            autoComplete="off"
            spellCheck={false}
            data-sidebar-menu-filter=""
            data-sidebar-menu-autofocus={sheet ? undefined : ""}
            onChange={(event) => onFilterQueryChange?.(event.target.value)}
          />
        </div>
      )}
      {filtered && (
        <div role="status">
          {filterQuery.trim() && !shown.some(isChoice) && <div className="sidebar-menu-empty">{filter.emptyLabel}</div>}
        </div>
      )}
      <div role="menu" aria-label={ariaLabel}>{list}</div>
      {hasFooter && footer}
    </>
  ) : list;
  const menuRole = custom || filtered || hasFooter ? undefined : "menu";

  if (!sheet) {
    return (
      <div
        ref={surfaceRef}
        className={classic ? "sidebar-menu is-classic" : "sidebar-menu"}
        role={menuRole ?? "dialog"}
        aria-label={ariaLabel}
        style={{ width }}
        {...isolateEvents}
      >
        {body}
      </div>
    );
  }

  return (
    <div className="sidebar-sheet-layer" {...isolateEvents}>
      {/* The backdrop takes the tap that closes the sheet, so it reaches neither the
          drawer's own backdrop (which would close the sidebar) nor a row. */}
      <div className="sidebar-sheet-backdrop" aria-hidden="true" onClick={() => onClose("outside")} />
      <div ref={surfaceRef} className="sidebar-sheet" role="dialog" aria-modal="true" aria-label={ariaLabel}>
        {title ? <div className="sidebar-sheet-title">{title}</div> : null}
        <div className="sidebar-sheet-body" role={menuRole} aria-label={menuRole ? ariaLabel : undefined}>{body}</div>
        <button
          type="button"
          className="sidebar-sheet-cancel"
          data-sidebar-menu-autofocus={focusCancel ? "" : undefined}
          onClick={() => onClose("cancel")}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

export function SidebarMenu({
  open,
  anchor,
  sheet,
  ariaLabel,
  title,
  items,
  filter,
  children,
  cancelLabel,
  focusCancel,
  onClose,
  returnFocusTo,
  width,
  classic = false,
  footer,
  focusKey = "",
}: SidebarMenuProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  // The one piece of state the menu keeps: its filter field's text, for one
  // opening of one body.
  const [filterQuery, setFilterQuery] = useState("");
  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The latest props for listeners attached once per opening.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const returnFocusToRef = useRef(returnFocusTo ?? null);
  returnFocusToRef.current = returnFocusTo ?? null;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const visible = open && portalTarget !== null && (sheet || anchor !== null);
  const custom = hasCustomMenuBody(children);
  const anchorKey = anchor ? JSON.stringify(anchor) : "";

  const activate = (item: MenuAction, shiftKey: boolean) => {
    if (item.disabled) return;
    let keepOpen = false;
    item.onSelect({ shiftKey, keepOpen: () => { keepOpen = true; } });
    if (!keepOpen) onCloseRef.current("select");
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  // Desktop placement: measure, then place, before the browser paints.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!visible || sheet || !surface) return;
    const viewport = window.visualViewport;
    const position = () => {
      const current = anchorRef.current;
      if (!current) return;
      const rect = surface.getBoundingClientRect();
      const { left, top } = placeSidebarMenu(current, { width: rect.width, height: rect.height }, {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      });
      surface.style.left = `${left}px`;
      surface.style.top = `${top}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(surface);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [visible, sheet, anchorKey, custom]);

  useEffect(() => {
    setFilterQuery("");
  }, [visible, custom]);

  // Focus moves into the menu when it opens, and again when its body is
  // swapped (the worktree menu turning into its form, or showing it below).
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!visible || !surface) return;
    initialFocusTarget(surface)?.focus({ preventScroll: true });
  }, [visible, sheet, custom, focusKey]);

  // On close, focus returns to the opener unless the user put it elsewhere.
  // The opener is taken now, as the menu opens: the parent closes it by
  // dropping its state, `returnFocusTo` included, before this cleanup runs.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!visible || !surface) return;
    const opener = returnFocusToRef.current;
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !surface.contains(active)) return;
      const target = menuFocusReturnTarget(opener);
      if (!target) return;
      target.focus({ preventScroll: true });
      // Keyboard focus on the row's main button shows its actions again
      // (:has(:focus-visible) in app/sidebar.css): the opener is back, so it
      // takes focus, as if it had never been hidden.
      if (opener && target !== opener && isRendered(opener)) opener.focus({ preventScroll: true });
    };
  }, [visible, sheet]);

  // Keys, in the capture phase on `document`: they reach the menu before any
  // bubble-phase listener, including the window-level Escape that stops a
  // running agent (hooks/useKeyboardShortcuts.ts), which skips an Escape
  // marked handled.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const surface = surfaceRef.current;
      if (!surface || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // A filter with text in it is cleared first; the next Escape closes.
        const field = surface.querySelector<HTMLElement>(FILTER_SELECTOR);
        if (field && filterQueryRef.current) {
          setFilterQuery("");
          field.focus({ preventScroll: true });
          return;
        }
        onCloseRef.current("escape");
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const inside = target !== null && surface.contains(target);
      const onPage = target === null || target === document.body || target === document.documentElement;
      if (!inside && !onPage) return;
      if (event.key === "Tab") {
        // No focus trap: Tab out of the menu closes it, and focus goes on from the opener.
        if (!inside || tabLeavesSurface(surface, target as Element, event.shiftKey)) onCloseRef.current("outside");
        return;
      }
      // The filter field keeps its letters and caret keys; Up and Down go on to the items.
      const leavesFilter = (event.key === "ArrowDown" || event.key === "ArrowUp") && target?.matches(FILTER_SELECTOR);
      if (inside && isTextEntry(target) && !leavesFilter) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        const list = enabledItems(surface);
        if (list.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const index = target ? list.indexOf(target as HTMLElement) : -1;
        let next: number;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = list.length - 1;
        else if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % list.length;
        else next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length;
        list[next].focus({ preventScroll: false });
        return;
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      const item = findSidebarMenuShortcut(itemsRef.current, event.key);
      if (!item || custom) return;
      event.preventDefault();
      event.stopPropagation();
      activateRef.current(item, event.shiftKey);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visible, custom]);

  // A press anywhere else closes a desktop menu and goes on to whatever it was
  // on (another row is selected by the same click). The sheet's backdrop
  // closes the sheet instead.
  useEffect(() => {
    if (!visible || sheet) return;
    const onPointerDown = (event: PointerEvent) => {
      const surface = surfaceRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (!surface || (target && surface.contains(target))) return;
      const opener = returnFocusToRef.current;
      if (opener && target && event.button === 0 && opener.contains(target)) swallowNextClickOn(opener);
      onCloseRef.current("outside");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [visible, sheet]);

  if (!visible || !portalTarget) return null;

  return createPortal(
    <SidebarMenuSurface
      sheet={sheet}
      ariaLabel={ariaLabel}
      title={title}
      items={items}
      filter={filter}
      filterQuery={filterQuery}
      onFilterQueryChange={setFilterQuery}
      cancelLabel={cancelLabel}
      focusCancel={focusCancel}
      width={width}
      classic={classic}
      footer={footer}
      surfaceRef={surfaceRef}
      onActivate={(item, shiftKey) => activateRef.current(item, shiftKey)}
      onClose={(reason) => onCloseRef.current(reason)}
    >
      {children}
    </SidebarMenuSurface>,
    portalTarget,
  );
}
