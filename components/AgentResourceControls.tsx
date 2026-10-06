"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentResourceItem } from "@/lib/subagent-resource-catalog";
import { matchingResourceEntries as matchingEntries, resourceMatchCandidates, resourceSelectionMode, type SubagentResourceSelection } from "@/lib/subagent-resource-selection";
import { parseNpmSource } from "@/lib/npm-source";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";
import { ConfigButton, ConfigEmptyState, ConfigScopeTag } from "./SettingsUi";

export type SubagentResourceKind = "skills" | "extensions";

/** Trigger coordinates from getBoundingClientRect(), in the layout viewport. */
export interface ResourcePickerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface ResourcePickerViewport {
  width: number;
  height: number;
  /** Visible viewport origin in layout-viewport coordinates (`visualViewport.offsetTop`). */
  offsetTop?: number;
  /** `visualViewport.offsetLeft`. */
  offsetLeft?: number;
}

export interface ResourcePickerLayout {
  above: boolean;
  /** Fixed-position top in layout-viewport coordinates, for both opening directions. */
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /** True when the anchor has no vertical overlap with the viewport (scrolled away or section hidden). */
  offscreen: boolean;
}

/**
 * Where a resource picker sits relative to its trigger: right-aligned below it when
 * there is room, flipped above it near the bottom edge, always inside the
 * viewport's width (a 390px phone included) and never wider than `maxWidth`.
 * Both edges are strictly clamped, so a header/search never lands at a
 * negative offset after the anchor scrolls off the top; an off-screen anchor
 * reports `offscreen` and the caller closes. `offsetTop`/`offsetLeft` carry a
 * `visualViewport` shift. Pure, so the boundary rules are testable without a DOM.
 */
export function resourcePickerLayout(
  anchor: ResourcePickerRect,
  viewport: ResourcePickerViewport,
  options: { margin?: number; gap?: number; maxWidth?: number; preferredHeight?: number; minVisible?: number } = {},
): ResourcePickerLayout {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 6;
  const maxWidth = options.maxWidth ?? 420;
  const preferredHeight = options.preferredHeight ?? 380;
  const minVisible = options.minVisible ?? 160;
  const offsetTop = viewport.offsetTop ?? 0;
  const offsetLeft = viewport.offsetLeft ?? 0;

  // Keep the trigger, visible boundaries and fixed top/left in the same
  // layout-viewport coordinates, as ChatWindow's quote popover does.
  // Shrink the margins too when zoom leaves less than two margins of room.
  const horizontalMargin = Math.min(margin, viewport.width / 2);
  const verticalMargin = Math.min(margin, viewport.height / 2);
  const viewLeft = offsetLeft + horizontalMargin;
  const viewRight = offsetLeft + viewport.width - horizontalMargin;
  const viewTop = offsetTop + verticalMargin;
  const viewBottom = offsetTop + viewport.height - verticalMargin;
  const width = Math.max(0, Math.min(maxWidth, viewRight - viewLeft));
  const left = Math.max(viewLeft, Math.min(anchor.left + anchor.width - width, viewRight - width));
  const offscreen = anchor.bottom <= viewTop || anchor.top >= viewBottom;

  const belowTop = anchor.bottom + gap;
  const spaceBelow = viewBottom - belowTop;
  const spaceAbove = anchor.top - gap - viewTop;
  const above = spaceBelow < minVisible && spaceAbove > spaceBelow;
  const maxHeight = Math.max(0, Math.min(preferredHeight, viewBottom - viewTop, above ? spaceAbove : spaceBelow));
  const desiredTop = above ? anchor.top - gap - maxHeight : belowTop;
  const top = Math.max(viewTop, Math.min(desiredTop, viewBottom - maxHeight));
  return { above, top, left, width, maxHeight, offscreen };
}

export interface ResourceSelectionSummary {
  mode: "all" | "none" | "selected";
  /** Explicit entries, excluding the wildcard, so the wildcard reads as its own mark. */
  selectedCount: number;
  hasWildcard: boolean;
  unknown: string[];
  ambiguous: string[];
}

/**
 * What a summary row reads: its mode, how many entries were chosen, and which
 * chosen entries no longer match the catalog. `catalogReady` is false while the
 * catalog is loading or failed, so a draft is never mislabelled unknown just
 * because the list has not arrived; those entries are kept.
 */
export function classifyResourceSelection(
  value: SubagentResourceSelection,
  items: SubagentResourceItem[],
  catalogReady: boolean,
): ResourceSelectionSummary {
  const selected = Array.isArray(value) ? value : [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  if (catalogReady) {
    for (const entry of selected) {
      if (entry === "*") continue;
      const matches = resourceMatchCandidates(entry, items);
      if (matches.length === 0) unknown.push(entry);
      else if (new Set(matches.map((match) => match.identity)).size > 1) ambiguous.push(entry);
    }
  }
  return {
    mode: resourceSelectionMode(value),
    selectedCount: selected.filter((entry) => entry !== "*").length,
    hasWildcard: selected.includes("*"),
    unknown,
    ambiguous,
  };
}

/** Whether a catalog entry is currently checked, with All and * reading as every enabled entry. */
export function isResourceItemChecked(value: SubagentResourceSelection, item: SubagentResourceItem, items: SubagentResourceItem[]): boolean {
  if (value === true) return item.enabled;
  if (value === false) return false;
  if (value.includes("*")) return item.enabled;
  return value.some((entry) => matchingEntries(entry, items).some((match) => match.identity === item.identity));
}

/**
 * The explicit list a first checkbox edit starts from. All expands to every
 * enabled catalog entry (so unchecking one keeps the rest) and None starts
 * empty. An explicit list containing the wildcard also expands to that enabled
 * set plus its own entries, so one checkbox click can drop a row (and the
 * wildcard with it) instead of asking for a separate wildcard removal. The
 * stored value stays the catalog `path`, never a display name.
 */
export function resourceSelectionBase(value: SubagentResourceSelection, items: SubagentResourceItem[]): string[] {
  if (value === true) return items.filter((item) => item.enabled).map((item) => item.path);
  if (value === false) return [];
  const explicit = value.filter((entry) => entry !== "*");
  if (!value.includes("*")) return [...explicit];
  const base = [...explicit];
  for (const item of items) {
    if (!item.enabled) continue;
    if (base.some((entry) => matchingEntries(entry, items).some((match) => match.identity === item.identity))) continue;
    base.push(item.path);
  }
  return base;
}

/** One checkbox change: drop every entry that resolved to this identity, then add the chosen one. */
export function toggleResourceItem(value: SubagentResourceSelection, item: SubagentResourceItem, checked: boolean, items: SubagentResourceItem[]): string[] {
  const remaining = resourceSelectionBase(value, items).filter((entry) => !matchingEntries(entry, items).some((match) => match.identity === item.identity));
  return checked ? [...remaining, item.path] : remaining;
}

/** The state of the picker's master bulk control: every enabled row, none, or some. */
export function resourceBulkState(value: SubagentResourceSelection, items: SubagentResourceItem[]): "all" | "none" | "partial" {
  const enabled = items.filter((item) => item.enabled);
  if (enabled.length === 0) return "none";
  const checked = enabled.filter((item) => isResourceItemChecked(value, item, items)).length;
  if (checked === 0) return "none";
  return checked === enabled.length ? "all" : "partial";
}

/**
 * One click selects every currently enabled catalog entry as an explicit path,
 * keeping the draft's own entries (unknown/ambiguous included). It stays an
 * array even when it covers the whole catalog, so a later-added resource is
 * never silently enabled; the explicit "disable all" action writes `false`.
 */
export function selectAllResourceItems(value: SubagentResourceSelection, items: SubagentResourceItem[]): string[] {
  const base = resourceSelectionBase(value, items);
  for (const item of items) {
    if (!item.enabled) continue;
    if (base.some((entry) => matchingEntries(entry, items).some((match) => match.identity === item.identity))) continue;
    base.push(item.path);
  }
  return base;
}

/** Drops one chosen entry by its exact value, unknown and wildcard included. */
export function removeResourceEntry(value: SubagentResourceSelection, entry: string): SubagentResourceSelection {
  return Array.isArray(value) ? value.filter((item) => item !== entry) : value;
}

/**
 * The name a row shows. Only an extension takes its package/plugin name, since
 * its entry file often sits in a build folder (`dist`, `src`); a skill always
 * keeps its SDK effective name, so two skills from one package stay distinct.
 * Display-only: it never changes the saved `path`/`identity`.
 */
export function resourceDisplayName(item: SubagentResourceItem, kind: SubagentResourceKind): string {
  if (kind !== "extensions" || item.metadata.origin !== "package") return item.name;
  const npm = parseNpmSource(item.metadata.source);
  if (npm?.name) return npm.name.replace(/^@[^/]+\//, "");
  const lower = item.name.toLowerCase();
  const packaged = item.names.find((name) => name !== lower && !["src", "dist", "build", "lib", "out", "esm", "cjs", "index"].includes(name));
  return packaged ?? item.name;
}

/** Search matches the shown name, the matching aliases, the source and the full path. */
export function filterResourceItems(items: SubagentResourceItem[], search: string, kind: SubagentResourceKind): SubagentResourceItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => `${item.name} ${resourceDisplayName(item, kind)} ${item.path} ${item.metadata.source}`.toLowerCase().includes(query));
}

/**
 * Whether a mousedown/focus target should close an open picker. Inside the
 * panel or on the summary block (its two Choose buttons) does not, so focusing
 * the other summary switches dimension instead of closing and reopening.
 */
export function isResourcePickerOutside(
  target: Node | null,
  panel: HTMLElement | null,
  anchor: HTMLElement | null,
): boolean {
  if (!target) return false;
  if (panel?.contains(target)) return false;
  if (anchor?.contains(target)) return false;
  return true;
}

/**
 * Closes the picker when a press or a focus move lands outside the panel and
 * the summary block: an outside `mousedown` (mouse, touch) or an outside
 * `focusin` (Tab to a page control, a section switch). Focus that dropped to
 * `body` from a click is ignored. A native Tab that reaches the document
 * boundary (browser chrome) fires no `focusin` on a new control, so it is
 * checked after the browser moves focus: still outside means dismiss. The check
 * is deferred, so a kind switch that briefly drops focus clears it before it
 * runs; a hidden section is handled by the visibility observer.
 */
export function bindResourcePickerDismissal(
  doc: Document,
  panel: HTMLElement | null,
  anchor: HTMLElement,
  onDismiss: () => void,
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const handle = (event: Event) => {
    const target = event.target as Node | null;
    if (event.type === "focusin" && (!target || target === doc.body)) return;
    if (isResourcePickerOutside(target, panel, anchor)) onDismiss();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (isResourcePickerOutside(doc.activeElement, panel, anchor)) onDismiss();
    }, 0);
    timers.add(timer);
  };
  doc.addEventListener("mousedown", handle);
  doc.addEventListener("focusin", handle);
  doc.addEventListener("keydown", handleKeyDown);
  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    doc.removeEventListener("mousedown", handle);
    doc.removeEventListener("focusin", handle);
    doc.removeEventListener("keydown", handleKeyDown);
  };
}

/**
 * Focuses a picker's trigger on an explicit close, when it is still on the page
 * and visible (`isConnected` alone would focus a trigger hidden with its
 * section). Returns whether focus moved.
 */
export function focusResourcePickerTrigger(trigger: HTMLElement | null): boolean {
  if (!trigger?.isConnected || trigger.getClientRects().length === 0) return false;
  trigger.focus({ preventScroll: true });
  return true;
}

/**
 * An explicit close (Escape, the × button): return focus to this picker's own
 * trigger, then close. An outside press/focus or an automatic close never goes
 * through here, so it keeps the user's new target instead of stealing it back.
 */
export function closeResourcePicker(trigger: HTMLElement | null, onClose: () => void): void {
  focusResourcePickerTrigger(trigger);
  onClose();
}

/**
 * Opens the picker overlay: the shared capture-phase Escape listener (so one
 * Escape closes only the picker and never Settings) and initial focus (the
 * search box on a fine pointer, the panel on a coarse one). Cleanup only stops
 * the listener — it never moves focus — so an outside press/focus or an
 * automatic close (hidden section, scrolled-away anchor, mode/profile/cwd
 * change) keeps whatever the user focused. The caller's Escape handler uses
 * `closeResourcePicker()` when it wants the explicit restore.
 */
export function openResourcePickerDialog(
  doc: Document,
  onEscape: () => void,
  panel: HTMLElement | null,
  search: HTMLInputElement | null,
): () => void {
  const stopEscape = listenForStackedDialogEscape(doc, onEscape);
  const coarse = doc.defaultView?.matchMedia("(pointer: coarse)").matches;
  (coarse ? panel : search)?.focus({ preventScroll: true });
  return stopEscape;
}

/**
 * Closes the picker when its anchor stops intersecting the viewport: the
 * settings section switched away (`hidden`, so the section host stays mounted
 * but `display:none`) or the grid scrolled fully off. A browser API, not a new
 * framework; absent, the `focusin`/scroll handlers still cover the cases.
 */
export function observeResourcePickerVisibility(
  win: Window & typeof globalThis,
  anchor: HTMLElement,
  onHidden: () => void,
): () => void {
  const Observer = win.IntersectionObserver;
  if (!Observer) return () => {};
  const observer = new Observer((entries) => {
    if (entries.some((entry) => !entry.isIntersecting)) onHidden();
  });
  observer.observe(anchor);
  return () => observer.disconnect();
}

/**
 * The status word a summary row and the picker header share: a boolean All or a
 * wildcard reads as "all", an empty selection as "none", and anything else as
 * its explicit count. An array that happens to cover the whole catalog stays a
 * count, so a later-added resource is never silently enabled.
 */
export function resourceSelectionStatus(summary: ResourceSelectionSummary): "all" | "none" | "selected" {
  if (summary.hasWildcard || summary.mode === "all") return "all";
  if (summary.selectedCount === 0) return "none";
  return "selected";
}

/** One summary row: label, a read-only status, any unknown/ambiguous warning, and Choose…. */
export function ResourceSummary({ kind, label, value, items, catalogReady, disabled, open, triggerRef, onChoose }: {
  kind: SubagentResourceKind; label: string; value: SubagentResourceSelection; items: SubagentResourceItem[]; catalogReady: boolean;
  disabled: boolean; open: boolean; triggerRef?: Ref<HTMLButtonElement>;
  onChoose: () => void;
}) {
  const { t } = useI18n();
  const summary = useMemo(() => classifyResourceSelection(value, items, catalogReady), [value, items, catalogReady]);
  const warningCount = summary.unknown.length + summary.ambiguous.length;
  const status = resourceSelectionStatus(summary);
  const statusText = status === "selected" ? t("agents.resource.selectedCount", { count: summary.selectedCount }) : t(`agents.resource.${status}`);
  return (
    <div className="agents-resource-summary" data-kind={kind}>
      <span className="agents-resource-summary-label">{label}</span>
      <span className="agents-resource-summary-status">
        <span className="agents-resource-count">{statusText}</span>
        {summary.hasWildcard && <code className="agents-resource-wildcard-mark" title={t("agents.resource.wildcard")}>*</code>}
        {warningCount > 0 && (
          <span role="alert" className="agents-resource-warning">
            {t("agents.resource.warning", { count: warningCount })}
          </span>
        )}
      </span>
      <ConfigButton
        ref={triggerRef}
        size="small"
        className="agents-resource-choose"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onChoose}
      >
        {t("agents.resource.choose")}
      </ConfigButton>
    </div>
  );
}

function ExpandToggle({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  const { t } = useI18n();
  const text = t("agents.resource.details");
  return (
    <button
      type="button"
      className="agents-resource-expand"
      aria-expanded={expanded}
      aria-label={`${text}: ${label}`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      <span>{text}</span>
    </button>
  );
}

function ResourceItemRow({ item, kind, value, items, disabled, expanded, onToggleExpand, onToggle }: {
  item: SubagentResourceItem; kind: SubagentResourceKind; value: SubagentResourceSelection; items: SubagentResourceItem[]; disabled: boolean;
  expanded: boolean; onToggleExpand: () => void; onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n();
  const name = resourceDisplayName(item, kind);
  const checked = isResourceItemChecked(value, item, items);
  return (
    <div className={`agents-resource-row${expanded ? " is-expanded" : ""}`}>
      <label className="agents-resource-row-main">
        <input
          type="checkbox"
          aria-label={name}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className="agents-resource-name" title={name}>{name}</span>
      </label>
      <ExpandToggle expanded={expanded} label={name} onToggle={onToggleExpand} />
      {expanded && (
        <div className="agents-resource-detail">
          <span className="agents-resource-detail-line">
            <ConfigScopeTag scope={item.metadata.scope === "project" ? "project" : "global"}>{item.metadata.scope}</ConfigScopeTag>
            <span className="agents-resource-detail-label">{t("agents.resource.source")}</span>
            <code className="agents-resource-source">{item.metadata.source}</code>
          </span>
          <span className="agents-resource-detail-line">
            <span className="agents-resource-detail-label">{t("agents.resource.path")}</span>
            <code className="agents-resource-path">{item.path}</code>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The picker's list body. Presentational (no portal or effects), so it also
 * renders in tests: search filters catalog rows, unknown/ambiguous draft
 * entries stay visible below them, and each catalog row expands to its source
 * and full path on demand.
 */
export function ResourcePickerList({ kind, value, items, catalogReady, disabled, search, expanded, onToggleExpand, onChange }: {
  kind: SubagentResourceKind; value: SubagentResourceSelection; items: SubagentResourceItem[]; catalogReady: boolean; disabled: boolean;
  search: string; expanded: ReadonlySet<string>;
  onToggleExpand: (key: string) => void;
  onChange: (value: SubagentResourceSelection) => void;
}) {
  const { t } = useI18n();
  const summary = useMemo(() => classifyResourceSelection(value, items, catalogReady), [value, items, catalogReady]);
  const visible = useMemo(() => filterResourceItems(items, search, kind), [items, search, kind]);
  const unknownRows = [
    ...summary.unknown.map((entry) => ({ entry, ambiguous: false })),
    ...summary.ambiguous.map((entry) => ({ entry, ambiguous: true })),
  ];
  return (
    <div className="agents-resource-picker-list">
      {summary.hasWildcard && (
        <div className="agents-resource-row is-wildcard">
          <label className="agents-resource-row-main">
            <input type="checkbox" checked disabled={disabled} onChange={() => onChange(removeResourceEntry(value, "*"))} />
            <span className="agents-resource-name">{t("agents.resource.wildcard")}</span>
          </label>
        </div>
      )}
      {visible.map((item) => (
        <ResourceItemRow
          key={item.identity}
          item={item}
          kind={kind}
          value={value}
          items={items}
          disabled={disabled}
          expanded={expanded.has(item.identity)}
          onToggleExpand={() => onToggleExpand(item.identity)}
          onToggle={(checked) => onChange(toggleResourceItem(value, item, checked, items))}
        />
      ))}
      {unknownRows.map(({ entry, ambiguous }) => (
        <div key={`${ambiguous ? "ambiguous" : "unknown"}:${entry}`} className="agents-resource-row is-unknown">
          <label className="agents-resource-row-main">
            <input type="checkbox" checked disabled={disabled} onChange={() => onChange(removeResourceEntry(value, entry))} />
            <span className="agents-resource-name">{entry}</span>
          </label>
          <span role="alert" className="agents-resource-unknown-note">
            {t(ambiguous ? "agents.resource.ambiguous" : "agents.resource.unknown")}
          </span>
        </div>
      ))}
      {visible.length === 0 && unknownRows.length === 0 && !summary.hasWildcard && (
        <ConfigEmptyState>{catalogReady ? t("agents.resource.empty") : t("agents.loading")}</ConfigEmptyState>
      )}
    </div>
  );
}

function ResourcePicker({ kind, label, value, items, catalogReady, disabled, summaryBoundary, trigger, onClose, onChange }: {
  kind: SubagentResourceKind; label: string; value: SubagentResourceSelection; items: SubagentResourceItem[]; catalogReady: boolean;
  disabled: boolean; summaryBoundary: HTMLElement; trigger: HTMLButtonElement;
  onClose: () => void;
  onChange: (value: SubagentResourceSelection) => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const computeLayout = useCallback(() => {
    if (typeof window === "undefined") return null;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    return resourcePickerLayout(
      { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
      {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        offsetTop: viewport?.offsetTop ?? 0,
        offsetLeft: viewport?.offsetLeft ?? 0,
      },
    );
  }, [trigger]);
  // Laid out during the first render, so the panel is visible when focus moves in.
  const [layout, setLayout] = useState<ResourcePickerLayout | null>(computeLayout);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [portalTarget] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : document.body));

  const summary = useMemo(() => classifyResourceSelection(value, items, catalogReady), [value, items, catalogReady]);
  const status = resourceSelectionStatus(summary);
  const bulk = resourceBulkState(value, items);
  const hasEnabled = items.some((item) => item.enabled);

  // Follow the active trigger while the settings pane, the page, or a phone keyboard
  // resizes; a fully off-screen anchor (or no room at all) closes the picker.
  const updateLayout = useCallback(() => {
    const next = computeLayout();
    if (!next) return;
    if (next.offscreen || next.maxHeight <= 0) {
      onCloseRef.current();
      return;
    }
    setLayout(next);
  }, [computeLayout]);

  useEffect(() => {
    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    window.visualViewport?.addEventListener("resize", updateLayout);
    window.visualViewport?.addEventListener("scroll", updateLayout);
    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
      window.visualViewport?.removeEventListener("resize", updateLayout);
      window.visualViewport?.removeEventListener("scroll", updateLayout);
    };
  }, [updateLayout]);

  // A short list is smaller than maxHeight. Keep its actual bottom next to the
  // trigger when flipped, still using only a layout-viewport top coordinate.
  // ResizeObserver also follows filtering/expanded details without moving focus.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !layout?.above) return;
    const position = () => {
      panel.style.top = `${layout.top + Math.max(0, layout.maxHeight - panel.getBoundingClientRect().height)}px`;
    };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [layout]);

  // Escape is an explicit close: it restores this picker's own trigger through
  // closeResourcePicker. Cleanup never moves focus, so an outside focus change or
  // an automatic close is not stolen back.
  useEffect(
    () => openResourcePickerDialog(document, () => closeResourcePicker(trigger, () => onCloseRef.current()), panelRef.current, searchRef.current),
    [trigger],
  );

  // A press or a focus move outside closes; the summary block and the panel do not.
  useEffect(
    () => bindResourcePickerDismissal(document, panelRef.current, summaryBoundary, () => onCloseRef.current()),
    [summaryBoundary],
  );

  // A hidden settings section (`hidden`, still mounted) or a scrolled-away
  // anchor leaves the viewport, closing the picker without a focus change.
  useEffect(
    () => observeResourcePickerVisibility(window, trigger, () => onCloseRef.current()),
    [trigger],
  );

  if (!portalTarget) return null;

  const style: CSSProperties = layout ? {
    position: "fixed",
    left: layout.left,
    width: layout.width,
    maxHeight: layout.maxHeight,
    zIndex: 1050,
    top: layout.top,
  } : { position: "fixed", top: 0, left: 0, visibility: "hidden", zIndex: 1050 };

  const toggleExpand = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return createPortal(
    <div
      ref={panelRef}
      className="agents-resource-picker"
      role="dialog"
      aria-label={label}
      data-kind={kind}
      tabIndex={-1}
      style={style}
    >
      <div className="agents-resource-picker-header">
        <strong>{label}</strong>
        <button
          type="button"
          className="agents-resource-picker-bulk"
          data-state={bulk}
          aria-pressed={bulk === "partial" ? "mixed" : bulk === "all"}
          aria-label={bulk === "all" ? t("agents.resource.clearAll") : t("agents.resource.selectAll")}
          title={bulk === "all" ? t("agents.resource.clearAll") : t("agents.resource.selectAll")}
          disabled={disabled || !hasEnabled}
          onClick={() => onChange(bulk === "all" ? false : selectAllResourceItems(value, items))}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
            <rect className="agents-resource-bulk-box" x="1" y="1" width="12" height="12" rx="3.2" />
            {bulk === "all" && <path className="agents-resource-bulk-check" d="M3.4 7.3 5.9 9.7 10.7 4.5" />}
            {bulk === "partial" && <rect className="agents-resource-bulk-dash" x="3.6" y="6.4" width="6.8" height="1.4" rx="0.7" />}
          </svg>
        </button>
        <span className="agents-resource-picker-count">{status === "selected" ? t("agents.resource.selectedCount", { count: summary.selectedCount }) : t(`agents.resource.${status}`)}</span>
        <button type="button" className="agents-resource-picker-close" aria-label={t("i18n.close")} onClick={() => closeResourcePicker(trigger, onClose)}>×</button>
      </div>
      <div className="agents-resource-picker-search">
        <input
          ref={searchRef}
          type="search"
          aria-label={`${label}: ${t("agents.resource.search")}`}
          placeholder={t("agents.resource.search")}
          value={search}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ResourcePickerList
        kind={kind}
        value={value}
        items={items}
        catalogReady={catalogReady}
        disabled={disabled}
        search={search}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        onChange={onChange}
      />
    </div>,
    portalTarget,
  );
}

/**
 * The compact Resources block: one summary row per kind (label, All/None/
 * Selected, the chosen count with any unknown/ambiguous warning, and Choose…),
 * and, only while chosen, a portal overlay with search and checkboxes. It keeps
 * one static SDK catalog for both rows, and drafts survive errors, retry, trust
 * and profile changes. Checkboxes and the overlay are display/navigation only:
 * opening, closing, searching and retrying never touch the draft.
 */
export function AgentResourceControls({ cwd, trustKey, profileKey, skills, extensions, disabled, onChange }: {
  cwd: string; trustKey: string; profileKey?: string | null;
  skills: SubagentResourceSelection; extensions: SubagentResourceSelection; disabled: boolean;
  onChange: (kind: SubagentResourceKind, value: SubagentResourceSelection) => void;
}) {
  const { t } = useI18n();
  const gridRef = useRef<HTMLDivElement>(null);
  const skillsTriggerRef = useRef<HTMLButtonElement>(null);
  const extensionsTriggerRef = useRef<HTMLButtonElement>(null);
  const [catalog, setCatalog] = useState<{ skills: SubagentResourceItem[]; extensions: SubagentResourceItem[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ message: string; path?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [picker, setPicker] = useState<SubagentResourceKind | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setCatalog(null);
    setDiagnostics([]);
    void (async () => {
      try {
        const response = await fetch(`/api/subagents/resources?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.error || !Array.isArray(data.skills) || !Array.isArray(data.extensions) || !Array.isArray(data.diagnostics)) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setCatalog({ skills: data.skills, extensions: data.extensions });
          setDiagnostics(data.diagnostics);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cwd, trustKey, retry]);

  // A new folder, trust decision or profile closes the old overlay; the draft
  // itself is untouched. Read-only mode cannot open one either.
  useEffect(() => {
    setPicker(null);
  }, [cwd, trustKey, profileKey, disabled]);

  const catalogReady = catalog !== null;
  const itemsFor = (kind: SubagentResourceKind) => (kind === "skills" ? catalog?.skills : catalog?.extensions) ?? [];

  const openKind = picker;
  const trigger = openKind === "skills" ? skillsTriggerRef.current : openKind === "extensions" ? extensionsTriggerRef.current : null;
  return (
    <div className="agents-resources">
      <div className="agents-resources-grid" ref={gridRef}>
        {(["skills", "extensions"] as const).map((kind) => {
          const label = t(kind === "skills" ? "agents.loadSkills" : "agents.loadExtensions");
          const value = kind === "skills" ? skills : extensions;
          return (
            <ResourceSummary
              key={kind}
              kind={kind}
              label={label}
              value={value}
              items={itemsFor(kind)}
              catalogReady={catalogReady}
              disabled={disabled}
              open={openKind === kind}
              triggerRef={kind === "skills" ? skillsTriggerRef : extensionsTriggerRef}
              onChoose={() => setPicker((current) => (current === kind ? null : kind))}
            />
          );
        })}
      </div>
      {loading && <span role="status">{t("agents.loading")}</span>}
      {error && <div role="alert">{error} <ConfigButton size="small" onClick={() => setRetry((value) => value + 1)}>{t("agents.resource.retry")}</ConfigButton></div>}
      {diagnostics.length > 0 && <details><summary>{t("agents.resource.diagnostics", { count: diagnostics.length })}</summary>{diagnostics.map((entry, index) => <div key={index}>{entry.message}{entry.path && <code> {entry.path}</code>}</div>)}</details>}
      {openKind && gridRef.current && trigger && (
        <ResourcePicker
          key={openKind}
          kind={openKind}
          label={t(openKind === "skills" ? "agents.loadSkills" : "agents.loadExtensions")}
          value={openKind === "skills" ? skills : extensions}
          items={itemsFor(openKind)}
          catalogReady={catalogReady}
          disabled={disabled}
          summaryBoundary={gridRef.current}
          trigger={trigger}
          onClose={() => setPicker(null)}
          onChange={(next) => onChange(openKind, next)}
        />
      )}
    </div>
  );
}
