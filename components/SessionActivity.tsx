"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import type { ActivityGroup, ActivityRow } from "@/lib/session-activity";
import { getVisibleRowIndices, type SidebarLayout } from "@/lib/session-tree";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import { formatShortRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import { sessionRowTitle } from "./SessionTree";
import { SpinnerIcon } from "./SidebarIcons";

type ActivitySessionRow = Extract<ActivityRow, { kind: "session" }>;

const GROUP_LABELS: Record<ActivityGroup, string> = {
  priority: "sidebar.activityPriority",
  today: "sidebar.activityToday",
  yesterday: "sidebar.activityYesterday",
  week: "sidebar.activityWeek",
  earlier: "sidebar.activityEarlier",
};
const OVERSCAN_PX = 240;

export function activityRowOffsets(rows: readonly ActivityRow[], layout: SidebarLayout): number[] {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1] + (row.kind === "header"
    ? (layout === "mobile" ? 36 : 28)
    : (layout === "mobile" ? 82 : 68)));
  return offsets;
}

/** A chronological, virtualized view of the same session families as the project tree. */
export function SessionActivity({ rows, layout, loading, error, onSelect }: {
  rows: ActivityRow[];
  layout: SidebarLayout;
  loading: boolean;
  error: string | null;
  onSelect(row: ActivitySessionRow): void;
}) {
  const { locale, t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibility(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const width = `${Math.max(0, element.offsetWidth - element.clientWidth)}px`;
      element.style.setProperty("--session-tree-scrollbar", width);
      if (element.offsetWidth > 0) element.closest<HTMLElement>(".session-sidebar")?.style.setProperty("--session-tree-scrollbar", width);
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const offsets = useMemo(() => activityRowOffsets(rows, layout), [rows, layout]);
  const focusedIndex = focusedKey ? rows.findIndex((row) => row.key === focusedKey) : -1;
  const visible = useMemo(() => loading ? [] : getVisibleRowIndices(
    offsets, scrollTop, viewportHeight, OVERSCAN_PX, focusedIndex >= 0 ? [focusedIndex] : [],
  ), [loading, offsets, scrollTop, viewportHeight, focusedIndex]);
  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest("[data-activity-row-key]") : null;
    setFocusedKey(row?.getAttribute("data-activity-row-key") ?? null);
  }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
  }, []);

  return (
    <div className={`session-tree session-activity${layout === "mobile" ? " is-mobile" : ""}`}>
      {loading && <div className="session-tree-message">{t("sidebar.loading")}</div>}
      {error && <div className="session-tree-message is-error">{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="session-tree-message">{t("sidebar.noSessions")}</div>}
      <div ref={scrollRef} className="session-tree-scroll scrollbar-subtle" onScroll={onScroll} onFocus={onFocus} onBlur={onBlur}>
        {!loading && <div className="session-tree-inner" style={{ height: offsets[rows.length] }}>
          {visible.map((index) => {
            const row = rows[index];
            const style = { top: offsets[index], height: offsets[index + 1] - offsets[index] };
            if (row.kind === "header") return <div key={row.key} className="session-tree-row session-activity-header" role="heading" aria-level={2} style={style} data-activity-row-key={row.key}>{t(GROUP_LABELS[row.group])}</div>;
            const title = sessionRowTitle(row.family.root);
            const status = row.awaiting
              ? <span className="session-tree-awaiting" role="img" aria-label={t("sidebar.agentAwaitingInput")} />
              : row.running ? <SpinnerIcon size={12} label={t("sidebar.agentRunning")} />
                : row.unread ? <span className="session-tree-unread" role="img" aria-label={t("sidebar.newSessionActivity")} /> : null;
            const content = <>
              <span className="session-activity-line">
                <span className="session-activity-title">{title}</span>
                <span className="session-activity-project" title={row.family.root.projectRoot ?? row.family.root.cwd}>{row.projectName}</span>
                <span className="session-activity-time">{formatShortRelativeTime(row.family.latestModified, locale, new Date(now))}</span>
                {row.retained && !row.running && !row.awaiting && <span className="session-activity-read">{t("sidebar.read")}</span>}
                {status}
              </span>
              {row.family.root.lastMessagePreview && <span className="session-activity-preview">{row.family.root.lastMessagePreview}</span>}
            </>;
            const select = (event: MouseEvent<HTMLAnchorElement>) => {
              if (!isPlainActivation(event)) return;
              event.preventDefault();
              onSelect(row);
            };
            return <div key={row.key} className={`session-tree-row session-activity-row${row.selected ? " is-selected" : ""}`} style={style} data-activity-row-key={row.key}>
              {row.family.root.transient
                ? <button type="button" className="session-activity-main" aria-current={row.selected ? "true" : undefined} onClick={() => onSelect(row)}>{content}</button>
                : <a className="session-activity-main" href={sessionDeepLink(row.family.root.id)} aria-current={row.selected ? "true" : undefined} onClick={select}>{content}</a>}
            </div>;
          })}
        </div>}
      </div>
    </div>
  );
}
