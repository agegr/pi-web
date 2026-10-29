"use client";

import { useMemo, useState } from "react";
import { buildContextMap, calculateFitMapScale, contextCategoryColor } from "@/lib/context-usage-map";
import { collectPreviewEntries, type ContextBreakdown, type ContextCategory, type ContextPreviewEntry } from "@/lib/context-usage-types";
import { formatCompactCount } from "@/lib/session-stats-format";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type ContextBreakdownState =
  | { status: "idle" | "loading" | "failed" | "compacting"; breakdown?: ContextBreakdown | null }
  | { status: "ready"; breakdown: ContextBreakdown };

interface Props {
  state: ContextBreakdownState;
  onRefresh: () => void;
  translate: Translate;
  locale: string;
  isMobile: boolean;
}

/** Ids whose labels the locale packs carry; any other label (a tool, a file) is shown as is. */
const TRANSLATED_CATEGORY_IDS = new Set([
  "system-prompt", "context-files", "skills", "built-in-tools", "custom-tools", "mcp-tools",
  "user-messages", "assistant-messages", "assistant-thinking", "tool-calls", "tool-output",
  "bash-executions", "extensions", "compacted-data", "prompt:preamble", "prompt:framing",
]);

/** Aggregates open from the start: per-tool output is the breakdown people look for. */
const EXPANDED_BY_DEFAULT = new Set(["tool-output"]);

const MAP_ROWS = 5;
const PREVIEW_BODY_CHARS = 600;

export function categoryLabel(category: Pick<ContextCategory, "id" | "label">, translate: Translate): string {
  return TRANSLATED_CATEGORY_IDS.has(category.id) ? translate(`session.contextCategory.${category.id}`) : category.label;
}

function findCategory(categories: readonly ContextCategory[], id: string): ContextCategory | undefined {
  for (const category of categories) {
    if (category.id === id) return category;
    const child = category.children && findCategory(category.children, id);
    if (child) return child;
  }
  return undefined;
}

/** The top-level category a row belongs to, which colors its marker and map cells. */
function topLevelId(categories: readonly ContextCategory[], id: string): string | undefined {
  return categories.find((category) => category.id === id || (category.children && findCategory(category.children, id)))?.id;
}

export function ContextUsageSection({ state, onRefresh, translate, locale, isMobile }: Props) {
  const breakdown = state.breakdown ?? null;
  const [scale, setScale] = useState<"window" | "fit">("window");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredTopId, setHoveredTopId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(EXPANDED_BY_DEFAULT));

  const contextWindow = breakdown?.reported?.contextWindow ?? 0;
  const fitScale = breakdown ? calculateFitMapScale(breakdown) : undefined;
  const fitUseful = fitScale !== undefined && fitScale < contextWindow;
  const activeScale = scale === "fit" && fitUseful ? fitScale : contextWindow;
  const columns = isMobile ? 20 : 40;
  const map = useMemo(
    () => (breakdown ? buildContextMap(breakdown, columns, MAP_ROWS, activeScale || undefined) : undefined),
    [breakdown, columns, activeScale],
  );
  const colors = useMemo(() => new Map(
    (breakdown?.categories ?? []).map((category, index) => [category.id, contextCategoryColor(category.id, index)]),
  ), [breakdown]);
  const selected = breakdown && selectedId ? findCategory(breakdown.categories, selectedId) : undefined;

  const count = (value: number) => value.toLocaleString(locale);
  const percent = (tokens: number) => (contextWindow > 0 ? `${(tokens / contextWindow * 100).toFixed(1)}%` : "");

  const header = (
    <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 12px", marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{translate("session.contextUsage")}</div>
      {breakdown?.reported && (
        <div style={{ color: "var(--text-muted)" }}>
          {translate("session.contextReported", {
            tokens: breakdown.reported.tokens === null
              ? "?"
              : `${formatCompactCount(breakdown.reported.tokens)}${breakdown.reported.percent === null ? "" : ` (${breakdown.reported.percent.toFixed(1)}%)`}`,
            window: formatCompactCount(breakdown.reported.contextWindow),
          })}
        </div>
      )}
      {breakdown && (
        <div style={{ color: "var(--text-dim)" }} title={translate("session.contextEstimateNote")}>
          {translate("session.contextEstimated", { tokens: formatCompactCount(breakdown.estimatedTokens) })}
        </div>
      )}
      {breakdown && (state.status === "failed" || state.status === "compacting") && (
        <div style={{ color: "var(--text-dim)", fontStyle: "italic" }}>
          {translate(state.status === "failed" ? "session.contextFailed" : "session.contextCompacting")}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {fitUseful && map && (
        <div role="group" aria-label={translate("session.contextScale")} style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
          {(["window", "fit"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scale === value}
              onClick={() => setScale(value)}
              style={{
                padding: "1px 8px",
                border: "none",
                background: scale === value ? "var(--bg-selected)" : "transparent",
                color: scale === value ? "var(--text)" : "var(--text-dim)",
                font: "inherit",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {translate(value === "window" ? "session.contextWindowScale" : "session.contextFitScale")}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={state.status === "loading"}
        title={translate("session.contextRefresh")}
        aria-label={translate("session.contextRefresh")}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, alignSelf: "center",
          color: "var(--text-dim)", background: "transparent",
          border: "1px solid var(--border)", borderRadius: 4,
          cursor: state.status === "loading" ? "default" : "pointer",
          opacity: state.status === "loading" ? 0.5 : 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
    </div>
  );

  if (!breakdown) {
    const message = state.status === "failed"
      ? translate("session.contextFailed")
      : state.status === "compacting"
        ? translate("session.contextCompacting")
        : translate("session.contextLoading");
    return (
      <div data-context-usage="true">
        {header}
        <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{message}</div>
      </div>
    );
  }

  const reserveTokens = breakdown.reserveTokens ?? 0;
  const freeTokens = Math.max(0, contextWindow - breakdown.estimatedTokens - reserveTokens);

  const legendRow = (category: ContextCategory, depth: number) => {
    const topId = topLevelId(breakdown.categories, category.id) ?? category.id;
    const hasChildren = Boolean(category.children?.length);
    const open = expanded.has(category.id);
    const isSelected = selectedId === category.id;
    return (
      <div key={category.id} style={{ display: "contents" }}>
        <button
          type="button"
          className={`context-legend-row${isSelected ? " is-selected" : ""}`}
          aria-pressed={isSelected}
          aria-expanded={hasChildren ? open : undefined}
          onClick={() => {
            if (hasChildren) {
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(category.id)) next.delete(category.id);
                else next.add(category.id);
                return next;
              });
            }
            setSelectedId((current) => (current === category.id ? null : category.id));
          }}
          onMouseEnter={() => setHoveredTopId(topId)}
          onMouseLeave={() => setHoveredTopId(null)}
          onFocus={() => setHoveredTopId(topId)}
          onBlur={() => setHoveredTopId(null)}
          title={category.label}
        >
          <span aria-hidden="true" style={{
            width: 10, height: 10, borderRadius: 2, marginLeft: depth * 2,
            background: depth === 0 ? colors.get(category.id) : "transparent",
            boxShadow: depth === 0 ? undefined : `inset 0 0 0 2px ${colors.get(topId)}`,
          }} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: depth * 12 }}>
            {hasChildren && <span aria-hidden="true" style={{ color: "var(--text-dim)", marginRight: 4 }}>{open ? "▾" : "▸"}</span>}
            {categoryLabel(category, translate)}
          </span>
          <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>{count(category.tokens)}</span>
          <span style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--text-dim)" }}>{percent(category.tokens)}</span>
        </button>
        {hasChildren && open && category.children!.map((child) => legendRow(child, depth + 1))}
      </div>
    );
  };

  const capacityRow = (label: string, tokens: number, swatch: "free" | "buffer") => (
    <div className="context-legend-row" key={swatch}>
      <span aria-hidden="true" className={`context-map-cell is-${swatch}`} style={{ width: 10, height: 10 }} />
      <span>{label}</span>
      <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>{count(tokens)}</span>
      <span style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--text-dim)" }}>{percent(tokens)}</span>
    </div>
  );

  const legend = (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      {breakdown.categories.map((category) => legendRow(category, 0))}
      {contextWindow > 0 && capacityRow(translate("session.contextFree"), freeTokens, "free")}
      {reserveTokens > 0 && capacityRow(translate("session.contextReserve"), reserveTokens, "buffer")}
    </div>
  );

  const mapView = map ? (
    <div style={{ minWidth: 0 }}>
      <div
        className="context-map"
        role="img"
        aria-label={translate("session.contextEstimated", { tokens: formatCompactCount(breakdown.estimatedTokens) })}
        style={{ gridTemplateColumns: `repeat(${map.columns}, minmax(0, 1fr))` }}
      >
        {map.cells.map((cell, index) => {
          const color = cell.categoryId ? colors.get(cell.categoryId) : undefined;
          const dimmed = hoveredTopId !== null && cell.categoryId !== hoveredTopId;
          const owner = cell.categoryId ? breakdown.categories.find((category) => category.id === cell.categoryId) : undefined;
          return (
            <div
              key={index}
              className={`context-map-cell is-${cell.fill}${dimmed ? " is-dimmed" : ""}`}
              style={color ? { background: color } : undefined}
              title={owner ? categoryLabel(owner, translate) : cell.fill === "buffer" ? translate("session.contextReserve") : undefined}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
        {translate("session.contextCell", { tokens: formatCompactCount(Math.round(map.blockTokens)) })}
        {scale === "fit" && fitUseful && (
          <> · {translate("session.contextFitNote", { scale: formatCompactCount(fitScale!), window: formatCompactCount(contextWindow) })}</>
        )}
      </div>
    </div>
  ) : (
    <div style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{translate("session.contextNoWindow")}</div>
  );

  return (
    <div data-context-usage="true" style={{ opacity: state.status === "loading" ? 0.7 : 1 }}>
      {header}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.4fr) minmax(260px, 1fr)",
        gap: isMobile ? 12 : 24,
        alignItems: "start",
      }}>
        {mapView}
        {legend}
      </div>
      {selected && (
        <ContextCategoryPreview
          category={selected}
          color={colors.get(topLevelId(breakdown.categories, selected.id) ?? selected.id)}
          onClose={() => setSelectedId(null)}
          translate={translate}
          locale={locale}
        />
      )}
    </div>
  );
}

function ContextCategoryPreview({ category, color, onClose, translate, locale }: {
  category: ContextCategory;
  color?: string;
  onClose: () => void;
  translate: Translate;
  locale: string;
}) {
  const entries = useMemo(() => collectPreviewEntries(category), [category]);
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
        <span style={{ fontWeight: 700, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {categoryLabel(category, translate)}
        </span>
        <span style={{ color: "var(--text-dim)" }}>{category.tokens.toLocaleString(locale)}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label={translate("session.contextClosePreview")}
          title={translate("session.contextClosePreview")}
          style={{ border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", font: "inherit", fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{translate("session.contextEmpty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
          {entries.map((entry, index) => (
            <PreviewEntry key={index} entry={entry} single={entries.length === 1} translate={translate} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewEntry({ entry, single, translate, locale }: {
  entry: ContextPreviewEntry;
  single: boolean;
  translate: Translate;
  locale: string;
}) {
  const [open, setOpen] = useState(single);
  const capped = !open && entry.text.length > PREVIEW_BODY_CHARS;
  const body = capped ? `${entry.text.slice(0, PREVIEW_BODY_CHARS)}…` : entry.text;
  const reasoning = entry.invisibleReasoning;
  return (
    <div className="context-preview-entry">
      <div style={{ display: "flex", gap: 8, padding: "4px 8px", borderBottom: body ? "1px solid var(--border)" : undefined, color: "var(--text-dim)" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.breadcrumb.map((cell) => `[${cell}]`).join(" ")}
        </span>
        {entry.timestamp !== undefined && <span>{new Date(entry.timestamp).toLocaleTimeString(locale)}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ whiteSpace: "nowrap" }}>{entry.tokens.toLocaleString(locale)}</span>
      </div>
      {reasoning && (
        <div style={{ padding: "4px 8px", color: "var(--text-dim)", fontStyle: "italic" }}>
          {translate(reasoning.basis === "provider-reported" ? "session.contextInvisibleReported" : "session.contextInvisibleProxy", {
            tokens: reasoning.tokens.toLocaleString(locale),
          })}
        </div>
      )}
      {body && <pre className="context-preview-body">{body}</pre>}
      {(entry.text.length > PREVIEW_BODY_CHARS || entry.truncatedChars) && (
        <div style={{ display: "flex", gap: 8, padding: "0 8px 6px", color: "var(--text-dim)", fontSize: 11 }}>
          {entry.text.length > PREVIEW_BODY_CHARS && !single && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit" }}
            >
              {translate(open ? "session.contextShowLess" : "session.contextShowAll")}
            </button>
          )}
          {open && entry.truncatedChars ? (
            <span>{translate("session.contextTruncated", { count: entry.truncatedChars.toLocaleString(locale) })}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
