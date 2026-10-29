"use client";

import { Component, Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { DebugClientSession, DebugEventConnectionSnapshot, DebugSessionDetail, DebugSessionSummary, DebugSnapshotResponse } from "@/lib/debug-types";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { StatusIcon } from "./AgentSessionPanel";
import { MCP_SESSION_STATE_KEYS } from "./mcp-config-helpers";
import { sessionRowTitle } from "./SessionTree";
import { FolderIcon, SpinnerIcon } from "./SidebarIcons";
import {
  DEBUG_CLOSE_REASON_KEYS,
  DEBUG_LEASE_OUTCOME_KEYS,
  DEBUG_POLL_MS,
  DEBUG_REATTACH_REASON_KEYS,
  DEBUG_RUN_STATUS_KEYS,
  DEBUG_SAMPLE_COUNT,
  DEBUG_STATUS_KEYS,
  DEBUG_STREAM_ERROR_KEYS,
  DEBUG_STREAM_STATE_KEYS,
  DEBUG_TICK_MS,
  EMPTY_DEBUG_SAMPLES,
  EMPTY_DEBUG_SERVER_READING,
  barFraction,
  createDebugPanelEscapeListener,
  createDebugPoller,
  debugHolderLabel,
  debugHolderTone,
  debugIssues,
  debugPollSample,
  debugPoolKindCounts,
  debugServerClock,
  debugSessionTitle,
  debugSlotTitle,
  debugStatusState,
  debugTargetSessionId,
  debugVerdict,
  formatAgo,
  formatBytes,
  formatCountdown,
  formatDebugDuration,
  formatShortDebugDuration,
  freshnessTone,
  groupDebugSessions,
  holderGroupLabel,
  joinParts as join,
  mcpServerTone,
  nextLeaseRenewalAt,
  pageAgentStreamCount,
  poolSlots,
  pushDebugSample,
  readClientSession,
  readDebugPage,
  runningPollSample,
  shortDebugId,
  sparkHeight,
  sparkStats,
  streamFreshness,
  thisPageFirst,
  translateDebugCode,
  type DebugIssue,
  type DebugPageReading,
  type DebugPool,
  type DebugPoolSlot,
  type DebugPoller,
  type DebugSample,
  type DebugSamples,
  type DebugServerClock,
  type DebugServerReading,
  type DebugSessionGroup,
  type DebugSessionRow,
  type DebugStatusState,
  type DebugTitleOf,
  type DebugTone,
  type DebugVerdict,
  type Translate,
} from "./debug-panel-state";

/**
 * The top bar's Debug panel: how this page talks to the server (its event stream, its lease, the
 * other streams it holds) and what the server holds for the selected session and overall. It only
 * reads: the chat's snapshot through a reader that reads refs, page-level bookkeeping
 * (lib/page-debug.ts), and `GET /api/agent/debug` every 2 s, which starts, renews and reconnects
 * nothing. Its clocks live here, not in AppShell, so a tick renders the panel alone. The sidebar
 * shows nothing: the panel lists the server's sessions itself.
 */

interface Props {
  /** The chat's snapshot reader, registered by ChatWindow; read in the tick, never in render. */
  readerRef: RefObject<(() => DebugClientSession) | null>;
  selectedSessionId: string | null;
  /** AppShell's session catalog: names and projects for the sessions the server lists. */
  sessions: readonly SessionInfo[];
  /** Escape; `restoreFocus`: focus was inside the panel, so it goes back to the Debug button. */
  onClose(restoreFocus: boolean): void;
}

/** Keeps a render error in the panel from taking the page down with it. */
export class DebugPanelBoundary extends Component<{ fallback: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Debug panel failed:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        style={{ padding: "10px 16px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12 }}
      >
        {this.props.fallback}
      </div>
    );
  }
}

export function DebugPanel({ readerRef, selectedSessionId, sessions, onClose }: Props) {
  const { t } = useI18n();
  const selectedRef = useRef(selectedSessionId);
  selectedRef.current = selectedSessionId;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pollerRef = useRef<DebugPoller | null>(null);
  const disposedRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  // The running poll's last record seen, so each poll is one sample.
  const lastRunningAtRef = useRef<number | null>(null);
  const [page, setPage] = useState<DebugPageReading | null>(null);
  const [server, setServer] = useState<DebugServerReading>(EMPTY_DEBUG_SERVER_READING);
  const [samples, setSamples] = useState<DebugSamples>(EMPTY_DEBUG_SAMPLES);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    disposedRef.current = false;
    const poller = createDebugPoller({
      fetch: (url, init) => fetch(url, init),
      sessionId: () => debugTargetSessionId(readClientSession(readerRef.current).client, selectedRef.current),
      isVisible: () => document.visibilityState === "visible",
      onReading: (reading) => {
        setServer(reading);
        const sample = debugPollSample(reading);
        if (sample) setSamples((current) => ({ ...current, poll: pushDebugSample(current.poll, sample) }));
      },
    });
    pollerRef.current = poller;
    const read = () => {
      const reading = readDebugPage(readerRef.current, poller.inFlightSince());
      setPage(reading);
      const last = reading.runningPoll?.last ?? null;
      if (last && last.at !== lastRunningAtRef.current) {
        lastRunningAtRef.current = last.at;
        const sample = runningPollSample(last);
        if (sample) setSamples((current) => ({ ...current, running: pushDebugSample(current.running, sample) }));
      }
    };
    read();
    poller.poll();
    const tick = window.setInterval(() => {
      // A hidden page shows nothing: no render each second for it, as the poll pauses too.
      if (document.visibilityState !== "visible") return;
      read();
      // A session picked in the sidebar: ask about it now, not at the next poll.
      poller.sync();
    }, DEBUG_TICK_MS);
    const pollTimer = window.setInterval(() => poller.poll(), DEBUG_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      read();
      poller.poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      // Disposed first: an answer still on its way never reaches the state.
      disposedRef.current = true;
      poller.dispose();
      pollerRef.current = null;
      window.clearInterval(tick);
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [readerRef]);

  useEffect(() => {
    pollerRef.current?.sync();
  }, [selectedSessionId]);

  // Escape closes the panel. On `document`, so it runs after whatever is nearer (a menu, ChatInput
  // stopping a run, React's own handlers, which run from `document` first) and before the window's
  // Stop shortcut, which a handled Escape skips.
  useEffect(() => {
    const handleKeyDown = createDebugPanelEscapeListener(
      document,
      () => sectionRef.current,
      (restoreFocus) => onCloseRef.current(restoreFocus),
    );
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCopy = () => {
    const payload = { client: page, server: server.reply };
    void copyText(JSON.stringify(payload, null, 2)).then(() => {
      if (disposedRef.current) return;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    }, () => {});
  };

  return (
    <DebugPanelView
      page={page}
      server={server}
      samples={samples}
      selectedSessionId={selectedSessionId}
      sessions={sessions}
      copied={copied}
      onCopy={handleCopy}
      t={t}
      sectionRef={sectionRef}
    />
  );
}

interface ViewProps {
  page: DebugPageReading | null;
  server: DebugServerReading;
  /** Round trips of the panel's poll and the sidebar's running poll, newest last. */
  samples?: DebugSamples;
  selectedSessionId: string | null;
  sessions: readonly SessionInfo[];
  copied: boolean;
  onCopy(): void;
  t: Translate;
  /** The panel's element, for the Escape that closes it to tell whether focus was inside. */
  sectionRef?: Ref<HTMLElement>;
}

/** What every part of the view reads. */
interface Ctx {
  t: Translate;
  /** The browser's clock when the page was read: the page's own times count from it. */
  now: number;
  /** Server times, on the server's clock; null before an answer. */
  clock: DebugServerClock | null;
  /** This page's id: its streams are the filled ones. */
  myHolder: string | null;
  titleOf: DebugTitleOf;
}

/** The panel itself, from what DebugPanel read; pure, so tests render it from fixtures. */
export function DebugPanelView({ page, server, samples = EMPTY_DEBUG_SAMPLES, selectedSessionId, sessions, copied, onCopy, t, sectionRef }: ViewProps) {
  const now = page?.at ?? server.receivedAt ?? 0;
  const client = page?.client ?? null;
  const targetSessionId = debugTargetSessionId(client, selectedSessionId);
  const reply = server.reply;
  const clock = reply && server.receivedAt !== null ? debugServerClock(reply.now, server.receivedAt, now) : null;
  // An answer about the session the panel shows: the poll drops the others, but one may still be
  // on screen for a second after the chat moved on.
  const detail = reply?.session && reply.session.sessionId === targetSessionId ? reply.session : null;
  const myHolder = client?.pageId ?? null;
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const titleOf = useMemo<DebugTitleOf>(() => (id) => {
    const info = byId.get(id);
    return info ? sessionRowTitle(info) : null;
  }, [byId]);
  const groups = useMemo(() => (reply ? groupDebugSessions(reply.sessions, byId, targetSessionId) : null), [reply, byId, targetSessionId]);
  const issues = page ? debugIssues({ page, server, detail, t, titleOf }) : [];
  const verdict = debugVerdict(page, server, issues);
  const ctx: Ctx = { t, now, clock, myHolder, titleOf };

  return (
    <section ref={sectionRef} className="debug-panel" aria-label={t("debug.panelLabel")}>
      <div className="debug-panel-header">
        <span className="debug-panel-heading" title={t("debug.readOnly")}>{t("debug.title")}</span>
        {/* Plain text, no live region: a screen reader would read out every change. */}
        <VerdictView verdict={verdict} t={t} />
        <button type="button" className="debug-panel-copy" onClick={onCopy} title={t("debug.copyTitle")}>
          {copied ? t("debug.copied") : t("debug.copyJson")}
        </button>
      </div>
      {page !== null && (
        <div className="debug-panel-scroll">
          {issues.length > 0 && <IssueList issues={issues} />}
          {/* The chat at a glance, four tiles side by side; the server's sessions and totals below, full width. */}
          <div className="debug-tiles">
            <PageTile page={page} samples={samples} ctx={ctx} />
            <StreamTile page={page} reply={reply} ctx={ctx} />
            <LeaseTile page={page} ctx={ctx} />
            <SessionCard reply={reply} detail={detail} targetSessionId={targetSessionId} ctx={ctx} />
          </div>
          <div className="debug-server">
            <SessionList reply={reply} detail={detail} groups={groups} sources={page.sources} ctx={ctx} />
          </div>
          <GlobalStrip reply={reply} ctx={ctx} />
        </div>
      )}
      <style>{DEBUG_PANEL_CSS}</style>
    </section>
  );
}

// ── Primitives ──

type GlyphKind = "server" | "warning" | "error";

/** One 24-grid stroke glyph in `currentColor`; decorative, the text beside it says what it is. */
function Glyph({ kind, size = 12 }: { kind: GlyphKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "server" && (
        <>
          <rect x="3" y="3" width="18" height="8" rx="2" />
          <rect x="3" y="13" width="18" height="8" rx="2" />
          <path d="M7 7h.01M7 17h.01" />
        </>
      )}
      {kind === "warning" && (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      )}
      {kind === "error" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </>
      )}
    </svg>
  );
}

interface BadgeItem {
  tone: DebugTone;
  /** This page's own: filled. */
  filled?: boolean;
  /** A stream still starting, a detached shell: a dashed outline. */
  dashed?: boolean;
  /** Lapsed, inactive or exited: drawn faint. */
  faded?: boolean;
  title: string;
  /** The badge's own word when it is not the run's: a liveness provider's name. */
  text?: string;
}

/** A badge's classes: the tone sets its color; filled, dashed and faint say whose it is and how it stands. */
function badgeClass(item: Pick<BadgeItem, "tone" | "filled" | "dashed" | "faded">, extra?: string): string {
  return ["debug-badge", extra, `is-${item.tone}`, item.filled && "is-filled", item.dashed && "is-dashed", item.faded && "is-faded"]
    .filter(Boolean)
    .join(" ");
}

/**
 * One boxed word per item ("SSE", a provider's name), each with its own tooltip, up to
 * `cap`, then "+n". The run is an image named `label`; `plain` drops the role when an enclosing
 * group already names it. No items, nothing.
 */
function BadgeRun({ text, items, cap, label, plain = false }: {
  text: string;
  items: readonly BadgeItem[];
  cap: number;
  label: string;
  plain?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <span className="debug-run" title={label} {...(plain ? {} : { role: "img", "aria-label": label })}>
      {items.slice(0, cap).map((item, index) => (
        <span key={index} className={badgeClass(item, item.text !== undefined ? "is-name" : undefined)} title={item.title}>
          {item.text ?? text}
        </span>
      ))}
      {items.length > cap && <span className="debug-run-more">{`+${items.length - cap}`}</span>}
    </span>
  );
}

function Dot({ tone, ring = false }: { tone: DebugTone; ring?: boolean }) {
  return <span className={`debug-dot is-${tone}${ring ? " is-ring" : ""}`} aria-hidden="true" />;
}

function Chip({ tone, children, title }: { tone: DebugTone; children: ReactNode; title?: string }) {
  return <span className={`debug-chip is-${tone}`} title={title}>{children}</span>;
}

/** A value against its scale; hidden from screen readers, whose text is the label and value beside it. */
function Bar({ fraction, tone, width, height = 4, notches, title, className }: {
  fraction: number;
  tone: DebugTone;
  width: number | string;
  height?: number;
  notches?: readonly number[];
  title?: string;
  className?: string;
}) {
  return (
    <span className={`debug-bar is-${tone}${className ? ` ${className}` : ""}`} style={{ width, height }} title={title} aria-hidden="true">
      <span className="debug-bar-fill" style={{ width: `${fraction * 100}%` }} />
      {notches?.map((notch) => <span key={notch} className="debug-bar-notch" style={{ left: `${notch * 100}%` }} />)}
    </span>
  );
}

// One width for the panel's bars and sparklines: a wide panel keeps a value next to its bar.
const BAR_WIDTH = 120;

const RING_LENGTH = 56.55; // 2π × 9

/** A countdown over its interval: the arc empties toward the moment; dashed and full while waiting. */
function Ring({ fraction, tone, dashed, label }: { fraction: number; tone: DebugTone; dashed: boolean; label: string }) {
  return (
    <span className={`debug-ring is-${tone}`} role="img" aria-label={label} title={label}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" strokeWidth="3" style={{ stroke: "var(--border)" }} />
        {dashed ? (
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="4 3" />
        ) : (
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - fraction)}
            transform="rotate(-90 12 12)"
          />
        )}
      </svg>
    </span>
  );
}

/**
 * Round trips, newest on the right; the 5 s timeout is full height, a failure is a full bar. The
 * bars stand on a full-width baseline one pixel below them, so a few short answers read as a
 * chart, not as a dashed line.
 */
function Sparkline({ samples, label }: { samples: readonly DebugSample[]; label: string }) {
  const shown = samples.slice(-DEBUG_SAMPLE_COUNT);
  return (
    <span className="debug-spark" role="img" aria-label={label} title={label}>
      <svg width="120" height="15" viewBox="0 0 120 15" aria-hidden="true">
        <rect x="0" y="14" width="120" height="1" style={{ fill: "var(--border)" }} />
        {shown.map((sample, index) => {
          const height = sample.failed ? 14 : Math.max(1, Math.round(sparkHeight(sample.ms) * 14));
          return (
            <rect
              key={index}
              className={`is-${sample.tone}`}
              x={120 - (shown.length - index) * 4 + 1}
              y={14 - height}
              width="3"
              height={height}
              fill="currentColor"
            />
          );
        })}
      </svg>
    </span>
  );
}

/** The sidebar's status slot: spinner, awaiting dot, or a ring by state. */
function StatusSlot({ state, label }: { state: DebugStatusState; label: string }) {
  if (state === "awaiting") {
    return (
      <span className="debug-status">
        <span className="session-tree-awaiting" role="img" aria-label={label} title={label} />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="debug-status is-accent" title={label}>
        <SpinnerIcon size={12} label={label} />
      </span>
    );
  }
  return (
    <span className="debug-status" role="img" aria-label={label} title={label}>
      <span className={`debug-status-ring is-${state}`} />
    </span>
  );
}

// ── A. Header and B. Issues ──

function VerdictView({ verdict, t }: { verdict: DebugVerdict; t: Translate }) {
  const text = {
    reading: () => t("debug.reading"),
    hidden: () => t("debug.poll.hidden"),
    issues: () => t("debug.health.issues", { count: verdict.count }),
    waiting: () => t("debug.poll.waiting"),
    ok: () => t("debug.health.ok"),
  }[verdict.kind]();
  return (
    <span className={`debug-panel-status is-${verdict.kind === "ok" ? "muted" : verdict.tone}`}>
      {verdict.kind === "issues" && <Glyph kind={verdict.tone === "error" ? "error" : "warning"} />}
      {verdict.kind === "ok" && <Dot tone="ok" />}
      {(verdict.kind === "hidden" || verdict.kind === "waiting") && <Dot tone="dim" ring />}
      <span className="debug-panel-status-text">{text}</span>
    </span>
  );
}

/** One line per fault: its tone's mark, then the sentence, which names what it is about. */
function IssueList({ issues }: { issues: readonly DebugIssue[] }) {
  return (
    <ul className="debug-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.id}:${index}`} className={`debug-issue is-${issue.tone}`}>
          <Glyph kind={issue.tone} />
          <span className="debug-issue-text">{issue.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ── C1. Browser tiles ──

function sparkLabel(samples: readonly DebugSample[], t: Translate): string {
  const stats = sparkStats(samples);
  if (stats.count === 0) return t("debug.notYet");
  return t("debug.spark.title", { count: stats.count, median: formatDebugDuration(stats.median, t), max: formatDebugDuration(stats.max, t) });
}

function SampleValue({ samples, t }: { samples: readonly DebugSample[]; t: Translate }) {
  const last = samples[samples.length - 1];
  if (!last) return <span className="debug-value is-dim">—</span>;
  return <span className={`debug-value is-${last.tone}`}>{last.failed ? "—" : formatDebugDuration(last.ms, t)}</span>;
}

function PageTile({ page, samples, ctx }: { page: DebugPageReading; samples: DebugSamples; ctx: Ctx }) {
  const { t } = ctx;
  const pool = poolSlots(page.sources, page.protocol, page.client?.connection?.sessionId ?? null);
  const running = page.runningPoll;
  return (
    <div className="debug-tile">
      <div className="debug-tile-head">
        <span className="debug-section-title">{t("debug.section.page")}</span>
        {pool.cap !== null && <span className={`debug-tile-value is-${pool.tone}`}>{`${pool.mine}/${pool.cap}`}</span>}
      </div>
      <Meter pool={pool} ctx={ctx} />
      <div className="debug-measures">
        <span className="debug-label">{t("debug.page.debugPoll")}</span>
        <Sparkline samples={samples.poll} label={sparkLabel(samples.poll, t)} />
        <SampleValue samples={samples.poll} t={t} />
        <span className="debug-label">{t("debug.page.runningPoll")}</span>
        <Sparkline
          samples={samples.running}
          label={join([running && t("debug.page.pollCounts", { count: running.count, failures: running.failures }), sparkLabel(samples.running, t)])}
        />
        <SampleValue samples={samples.running} t={t} />
      </div>
    </div>
  );
}

/** HTTP/1.1's six connections as six slots, filled by this page's own sources, oldest first. */
function Meter({ pool, ctx }: { pool: DebugPool; ctx: Ctx }) {
  const { t, now, titleOf } = ctx;
  // The slots' own titles are not read inside an image: its name says what they count.
  const kindCounts = debugPoolKindCounts(pool, t);
  const label = pool.cap !== null
    ? join([`${t("debug.page.http1", { protocol: pool.protocol ?? "" })} · ${pool.mine}/${pool.cap}`, ...kindCounts])
    : join([t("debug.section.page"), ...kindCounts, pool.protocol ?? t("debug.unknown")]);
  const cells: (DebugPoolSlot | null)[] = pool.cap !== null
    ? Array.from({ length: pool.cap }, (_, index) => pool.slots[index] ?? null)
    : pool.slots;
  return (
    <div className="debug-meter-row">
      <span className={`debug-meter${pool.cap === null ? " is-inline" : ""}`} role="img" aria-label={label} title={label}>
        {cells.map((slot, index) => slot ? (
          // The chat's own stream filled, a stream kept through its grace and the rest outlined;
          // amber and dashed while connecting.
          <span
            key={slot.id}
            className={badgeClass({ tone: slot.connecting ? "warning" : slot.chat ? "accent" : "muted", filled: slot.chat, dashed: slot.connecting }, "debug-slot")}
            title={debugSlotTitle(slot, now, t, titleOf)}
          >
            {slot.kind === "agent" ? "SSE" : t(SLOT_TEXT_KEYS[slot.kind])}
          </span>
        ) : (
          <span key={`empty:${index}`} className="debug-slot is-empty" />
        ))}
        {pool.overflow > 0 && <span className="debug-meter-overflow is-error">{`+${pool.overflow}`}</span>}
      </span>
      {pool.cap === null && pool.protocol !== null && <Chip tone="dim">{pool.protocol}</Chip>}
    </div>
  );
}

/** A meter slot's word for what is not an agent stream ("SSE"). */
const SLOT_TEXT_KEYS: Record<Exclude<DebugPoolSlot["kind"], "agent">, string> = {
  "file-watch": "debug.box.file",
  terminal: "debug.box.terminal",
};

const STREAM_DOTS: Record<DebugEventConnectionSnapshot["state"], { tone: DebugTone; ring: boolean }> = {
  connected: { tone: "ok", ring: false },
  connecting: { tone: "warning", ring: true },
  retrying: { tone: "warning", ring: false },
  idle: { tone: "dim", ring: true },
};

/** The stream's history, one line each, only what is known: the state's tooltip. */
function streamStateTitle(client: DebugClientSession, connection: DebugEventConnectionSnapshot, page: DebugPageReading, t: Translate): string {
  const now = page.at;
  const ago = (at: number) => formatAgo(now - at, t);
  const lines: (string | false)[] = [
    connection.readyState !== null && t("debug.stream.readyState", { value: connection.readyState }),
    connection.openedAt !== null && `${t("debug.stream.opened")} ${ago(connection.openedAt)}`,
    connection.connectedAt !== null && `${t("debug.stream.connected")} ${ago(connection.connectedAt)}`,
    `${t("debug.stream.opens")} ${t("debug.stream.opensRetries", { opens: connection.opens, retries: connection.retries })}`,
    connection.lastError !== null && `${t("debug.stream.lastError")} ${join([
      translateDebugCode(connection.lastError.reason, DEBUG_STREAM_ERROR_KEYS, t),
      connection.lastError.message,
      ago(connection.lastError.at),
    ])}`,
    connection.lastClose !== null && `${t("debug.stream.lastClose")} ${join([
      connection.lastClose.reason ? translateDebugCode(connection.lastClose.reason, DEBUG_CLOSE_REASON_KEYS, t) : "—",
      ago(connection.lastClose.at),
    ])}`,
    `${t("debug.stream.wanted")} ${t(client.wantsStream ? "debug.yes" : "debug.no")}`,
  ];
  const visibility = page.visibility;
  if (visibility && visibility.hiddenCount > 0) {
    lines.push(join([
      t("debug.page.hiddenCount", { count: visibility.hiddenCount }),
      visibility.lastHiddenAt !== null && t("debug.page.lastHidden", { time: ago(visibility.lastHiddenAt) }),
    ]));
  }
  if (client.released.count > 0) {
    lines.push(`${t("debug.stream.released")} ${join([
      t("debug.times", { count: client.released.count }),
      client.released.lastAt !== null && ago(client.released.lastAt),
    ])}`);
  }
  if (client.reattached.count > 0) {
    lines.push(`${t("debug.stream.reattached")} ${join([
      t("debug.times", { count: client.reattached.count }),
      client.reattached.lastAt !== null && ago(client.reattached.lastAt),
      client.reattached.lastReason && t(DEBUG_REATTACH_REASON_KEYS[client.reattached.lastReason]),
    ])}`);
  }
  return lines.filter(Boolean).join("\n");
}

function StreamTile({ page, reply, ctx }: { page: DebugPageReading; reply: DebugSnapshotResponse | null; ctx: Ctx }) {
  const { t, now } = ctx;
  const client = page.client;
  const connection = client?.connection ?? null;
  const freshness = streamFreshness(connection, now);
  return (
    <div className="debug-tile">
      <div className="debug-tile-head">
        <span className="debug-section-title">{t("debug.section.stream")}</span>
        {client && connection && (
          <span className="debug-tile-value is-muted" title={streamStateTitle(client, connection, page, t)}>
            <Dot tone={STREAM_DOTS[connection.state]?.tone ?? "dim"} ring={STREAM_DOTS[connection.state]?.ring ?? true} />
            <span>{t(DEBUG_STREAM_STATE_KEYS[connection.state] ?? "debug.unknown")}</span>
          </span>
        )}
      </div>
      {!client ? (
        <div className="debug-empty">{page.clientFailed ? "—" : t("debug.stream.noChat")}</div>
      ) : !connection ? (
        <div className="debug-empty">{t("debug.stream.noConnection")}</div>
      ) : (
        <>
          {freshness && <FreshnessRow connection={connection} freshness={freshness} heartbeatMs={reply?.server.heartbeatMs ?? 0} ctx={ctx} />}
          <div className="debug-line">
            {join([
              `${t("debug.stream.events")} ${connection.events}`,
              connection.retries > 0 && `${t("debug.stream.opens")} ${t("debug.stream.opensRetries", { opens: connection.opens, retries: connection.retries })}`,
            ])}
          </div>
        </>
      )}
      {client && (client.released.active || client.graceDueAt !== null) && (
        <div className="debug-chips">
          {client.released.active && <Chip tone="accent">{t("debug.stream.close.released")}</Chip>}
          {client.graceDueAt !== null && <Chip tone="accent">{`${t("debug.stream.grace")} ${formatCountdown(client.graceDueAt - now, t)}`}</Chip>}
        </div>
      )}
    </div>
  );
}

/** Time since the stream's last byte against the watchdog's limit, notched at each heartbeat. */
function FreshnessRow({ connection, freshness, heartbeatMs, ctx }: {
  connection: DebugEventConnectionSnapshot;
  freshness: { ageMs: number; staleAfterMs: number };
  heartbeatMs: number;
  ctx: Ctx;
}) {
  const { t, now } = ctx;
  const { ageMs, staleAfterMs } = freshness;
  const tone = freshnessTone(ageMs, staleAfterMs);
  const notches: number[] = [];
  if (heartbeatMs > 0) {
    for (let at = heartbeatMs; at < staleAfterMs && notches.length < 12; at += heartbeatMs) notches.push(at / staleAfterMs);
  }
  const title = join([
    `${t("debug.stream.lastData")} ${formatAgo(ageMs, t)}`,
    connection.lastHeartbeatAt !== null && t("debug.stream.heartbeat", { time: formatAgo(now - connection.lastHeartbeatAt, t) }),
    t("debug.stream.watchdogArmed", { time: formatDebugDuration(staleAfterMs, t) }),
  ]);
  return (
    <div className="debug-measures">
      <span className="debug-label">{t("debug.stream.lastData")}</span>
      <Bar fraction={barFraction(ageMs, staleAfterMs) ?? 0} tone={tone} width={BAR_WIDTH} notches={notches} title={title} />
      <span className={`debug-value is-${tone}`} title={title}>{formatDebugDuration(ageMs, t)}</span>
    </div>
  );
}

function LeaseTile({ page, ctx }: { page: DebugPageReading; ctx: Ctx }) {
  const { t, now } = ctx;
  const lease = page.client?.lease ?? null;
  const pageId = page.client?.pageId ?? null;
  let body: ReactNode;
  if (!lease) {
    body = <div className="debug-empty">{page.clientFailed ? "—" : t("debug.stream.noChat")}</div>;
  } else if (lease.requests === 0) {
    body = <div className="debug-empty">{t("debug.lease.noHolder")}</div>;
  } else {
    const last = lease.last;
    const next = nextLeaseRenewalAt(lease.renewStartedAt, lease.renewIntervalMs, now);
    const waiting = lease.inFlightSince !== null && now - lease.inFlightSince >= DEBUG_POLL_MS;
    const tone: DebugTone = waiting || last?.outcome === "unanswered" ? "warning" : last?.outcome === "error" ? "error" : "muted";
    const counts = t("debug.lease.countsValue", { requests: lease.requests, unanswered: lease.unanswered, errors: lease.errors });
    const ringLabel = join([
      t("debug.lease.every", { time: formatDebugDuration(lease.renewIntervalMs, t) }),
      counts,
      pageId !== null && `${t("debug.holder.thisPage")} ${shortDebugId(pageId)}`,
    ]);
    body = (
      <>
        {next === null ? (
          <div className="debug-empty">—</div>
        ) : (
          <div className="debug-measures">
            <Ring fraction={waiting ? 1 : barFraction(next - now, lease.renewIntervalMs) ?? 0} tone={tone} dashed={waiting} label={ringLabel} />
            <span className="debug-label">{t("debug.lease.next")}</span>
            <span className="debug-value is-muted">{formatCountdown(next - now, t)}</span>
          </div>
        )}
        <div className="debug-line">
          {`${t("debug.lease.last")} ${last
            ? join([
              t(DEBUG_LEASE_OUTCOME_KEYS[last.outcome] ?? "debug.unknown"),
              formatDebugDuration(last.durationMs, t),
              last.outcome === "error" && last.httpStatus !== null && `HTTP ${last.httpStatus}`,
              formatAgo(now - last.at, t),
            ])
            : t("debug.notYet")}`}
        </div>
        {(lease.unanswered > 0 || lease.errors > 0) && <div className="debug-line">{counts}</div>}
      </>
    );
  }
  return (
    <div className="debug-tile">
      <div className="debug-tile-head">
        <span className="debug-section-title">{t("debug.section.lease")}</span>
      </div>
      {body}
    </div>
  );
}

// ── C2a. Server · this session ──

function SessionCard({ reply, detail, targetSessionId, ctx }: {
  reply: DebugSnapshotResponse | null;
  detail: DebugSessionDetail | null;
  targetSessionId: string | null;
  ctx: Ctx;
}) {
  const { t, clock } = ctx;
  let body: ReactNode;
  if (!targetSessionId) body = <div className="debug-empty">{t("debug.server.noSession")}</div>;
  else if (!reply || !detail || !clock) body = <div className="debug-empty">{t("debug.poll.waiting")}</div>;
  else body = <SessionCardBody detail={detail} clock={clock} ctx={ctx} />;
  return (
    <div className="debug-card">
      <span className="debug-section-title">{t("debug.section.session")}</span>
      {body}
    </div>
  );
}

function SessionCardBody({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, titleOf } = ctx;
  const wrapper = detail.wrapper;
  const lifecycle = detail.lifecycle;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const title = titleOf(detail.sessionId);
  const name = title ?? shortDebugId(detail.sessionId);
  const status: DebugStatusState = wrapper
    ? debugStatusState({ awaitingInput: wrapper.awaitingInput, running: wrapper.run.running, state: wrapper.state })
    : detail.starting ? "starting" : "none";
  const closing = wrapper?.state === "closing"
    ? wrapper.closingAt !== null ? t("debug.server.closingSince", { time: ago(wrapper.closingAt) }) : t("debug.state.closing")
    : null;
  const statusLabel = join([
    t(DEBUG_STATUS_KEYS[status]),
    wrapper?.startedAt != null && `${t("debug.server.started")} ${ago(wrapper.startedAt)}`,
    closing,
  ]);
  const live = wrapper !== null && !wrapper.stale;

  return (
    <>
      <div className="debug-card-head">
        <StatusSlot state={status} label={statusLabel} />
        <span className="debug-card-title" title={name}>{name}</span>
        {title !== null && <span className="debug-card-id">{shortDebugId(detail.sessionId)}</span>}
        {!wrapper && <span className="debug-note">{t(detail.starting ? "debug.server.starting" : "debug.server.noWrapper")}</span>}
        {closing && <Chip tone="warning">{closing}</Chip>}
        {wrapper?.chatOnly && <Chip tone="dim">{t("debug.server.chatOnly")}</Chip>}
        {wrapper?.subagent && <Chip tone="dim">{t("debug.server.subagent")}</Chip>}
        {wrapper?.stale && <Chip tone="warning">{t("debug.server.stale")}</Chip>}
        {lifecycle && lifecycle.starts > 1 && (
          <span
            className="debug-starts"
            title={join([
              t("debug.overlay.starts", { count: lifecycle.starts }),
              t("debug.server.lastStart", { time: ago(lifecycle.lastStartedAt) }),
              lifecycle.lastClosedAt !== null && t("debug.server.lastClosed", { time: ago(lifecycle.lastClosedAt) }),
            ])}
          >
            {`↻${lifecycle.starts}`}
          </span>
        )}
      </div>
      <ListenerMismatch detail={detail} t={t} />
      {live && wrapper && <CardRun detail={detail} clock={clock} ctx={ctx} />}
      {live && <CardSubagents detail={detail} clock={clock} ctx={ctx} />}
      {live && <CardMcp detail={detail} clock={clock} ctx={ctx} />}
    </>
  );
}

/** A wrapper whose listeners differ from the streams the server lists for it: one leaked or lost. */
function ListenerMismatch({ detail, t }: { detail: DebugSessionDetail; t: Translate }) {
  const wrapper = detail.wrapper;
  const mismatch = wrapper !== null && !wrapper.stale
    && detail.eventStreams.every((stream) => stream.connectedAt !== null)
    && wrapper.eventListeners !== detail.eventStreams.length;
  if (!mismatch || !wrapper) return null;
  return <div className="debug-chips"><Chip tone="warning">{`${t("debug.server.listeners")} ${wrapper.eventListeners}`}</Chip></div>;
}

/**
 * The chat's row in the list: one badge per event stream ("SSE") and liveness provider (its name)
 * the server holds for the session, with the holders the other rows' summaries lack: this page's
 * first and filled. Same caps as the other rows.
 */
function DetailBadges({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, myHolder } = ctx;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const streams = thisPageFirst([...detail.eventStreams].sort((a, b) => a.openedAt - b.openedAt), myHolder);
  const streamItems: BadgeItem[] = streams.map((stream) => {
    const starting = stream.connectedAt === null;
    return {
      tone: starting || stream.droppedEvents > 0 ? "warning" : debugHolderTone(stream.holder, myHolder),
      filled: stream.holder !== null && stream.holder === myHolder,
      dashed: starting,
      title: join([
        debugHolderLabel(stream.holder, myHolder, t),
        stream.connectedAt !== null ? t("debug.server.streamConnected", { time: ago(stream.connectedAt) }) : t("debug.server.streamStarting"),
        stream.lastWriteAt !== null && t("debug.server.lastWrite", { time: ago(stream.lastWriteAt) }),
        stream.droppedEvents > 0 && t("debug.server.dropped", { count: stream.droppedEvents }),
        stream.queuedBytes > 0 && t("debug.server.queued", { size: formatBytes(stream.queuedBytes) }),
      ]),
    };
  });
  const providers = detail.providers;
  // Names unknown (server code from before a reload): one dim badge with the generic word.
  const providerItems: BadgeItem[] = providers === null
    ? [{ tone: "dim", title: t("debug.server.providersUnknown") }]
    : providers.map((provider) => ({
      tone: provider.active === "error" ? "error" : provider.active ? "muted" : "dim",
      faded: provider.active === false,
      text: provider.name,
      title: join([
        provider.name,
        t(provider.active === "error" ? "debug.server.providerError" : provider.active ? "debug.server.providerActive" : "debug.server.providerInactive"),
        provider.byFile && t("debug.server.byFile"),
      ]),
    }));
  return (
    <>
      <BadgeRun text="SSE" items={streamItems} cap={3} label={holderGroupLabel("SSE", streams.map((stream) => stream.holder), myHolder, t)} />
      <BadgeRun
        text={t("debug.box.provider")}
        items={providerItems}
        cap={1}
        label={`${t("debug.server.providers")}: ${providers === null ? t("debug.server.providersUnknown") : providers.length}`}
      />
    </>
  );
}

/** The run's chips, the idle timer and the last event and command. */
function CardRun({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t } = ctx;
  const wrapper = detail.wrapper;
  if (!wrapper) return null;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const run = wrapper.run;
  const dimChips = [
    run.streaming && t("debug.run.streaming"),
    run.promptRunning && t("debug.run.prompt"),
    run.bashRunning && t("debug.run.bash"),
    run.compacting && t("debug.run.compacting"),
    run.queuedMessages > 0 && t("debug.run.queued", { count: run.queuedMessages }),
    run.runningTools > 0 && t("debug.run.tools", { count: run.runningTools }),
    run.mutatingCommands > 0 && t("debug.run.mutating", { count: run.mutatingCommands }),
    run.replacement && t("debug.run.replacement", { kind: run.replacement }),
    wrapper.extensions === "binding" && `${t("debug.server.extensions")} ${t("debug.server.extensions.binding")}`,
  ].filter((chip): chip is string => Boolean(chip));
  const warnChips = [
    run.pendingPrompts > 0 && t("debug.run.pending", { count: run.pendingPrompts }),
    run.retrying && t("debug.run.retrying"),
    run.waitingForMcp && t("debug.run.waitingForMcp"),
    wrapper.awaitingInput && wrapper.pendingUiRequests > 0 && t("debug.server.uiRequests", { count: wrapper.pendingUiRequests }),
    wrapper.awaitingInput && wrapper.customUis > 0 && t("debug.server.customUis", { count: wrapper.customUis }),
  ].filter((chip): chip is string => Boolean(chip));

  const idle = wrapper.idle;
  const idleShown = idle.nextCheckAt !== null && (idle.timeoutMs > 0 || idle.forcedByStop);
  const remaining = idle.nextCheckAt !== null ? clock.remaining(idle.nextCheckAt) : 0;
  const idleFraction = barFraction(remaining, idle.timeoutMs);
  const idleTitle = join([
    idle.timeoutMs > 0 && t("debug.server.idleTimeout", { time: formatDebugDuration(idle.timeoutMs, t) }),
    idle.lastResetAt !== null && t("debug.server.idleReset", { time: ago(idle.lastResetAt) }),
    t(idle.forcedByStop ? "debug.server.idleForced" : "debug.server.idleHint"),
  ]);
  // Only the time: the label says what it counts down to, the title what moves it.
  const idleTime = remaining > 0 ? formatDebugDuration(remaining, t) : t("debug.time.due");
  const activity = join([
    wrapper.lastEvent && `${t("debug.server.lastEvent")} ${wrapper.lastEvent.type} ${ago(wrapper.lastEvent.at)}`,
    wrapper.lastCommand && `${t("debug.server.lastCommand")} ${wrapper.lastCommand.type} ${ago(wrapper.lastCommand.at)}`,
  ]);
  return (
    <>
      {dimChips.length + warnChips.length > 0 && (
        <div className="debug-chips">
          {dimChips.map((chip) => <Chip key={chip} tone="dim">{chip}</Chip>)}
          {warnChips.map((chip) => <Chip key={chip} tone="warning">{chip}</Chip>)}
        </div>
      )}
      {idleShown && (
        <div className="debug-idle-row">
          <span className="debug-label">{t("debug.server.idle")}</span>
          {idleFraction !== null && (
            <Bar fraction={idleFraction} tone={idle.forcedByStop ? "warning" : "dim"} width={BAR_WIDTH} title={idleTitle} className="debug-idle-bar" />
          )}
          {/* Closing after Stop: the list rows' stop square, not the amber alone. */}
          {idle.forcedByStop && <span className="debug-row-forced is-warning" role="img" aria-label={t("debug.server.idleForced")} title={t("debug.server.idleForced")} />}
          <span className={`debug-value is-${idle.forcedByStop ? "warning" : "muted"}`} title={idleTitle}>{idleTime}</span>
        </div>
      )}
      {activity && <div className="debug-line">{activity}</div>}
    </>
  );
}

const RUN_TONES: Partial<Record<string, DebugTone>> = {
  completed: "ok",
  failed: "error",
  aborted: "warning",
  interrupted: "warning",
};

/** A subagent run's mark: the sidebar's spinner while it runs, the agent switcher's shapes once settled. */
function RunIcon({ status }: { status: string }) {
  if (status === "running" || status === "starting") {
    return <span className="debug-run-icon is-accent"><SpinnerIcon size={12} /></span>;
  }
  const tone = RUN_TONES[status];
  if (tone) return <span className={`debug-run-icon is-${tone}`}><StatusIcon status={status as SubagentSessionStatus} /></span>;
  return <span className="debug-run-icon"><span className="debug-status-ring is-alive" /></span>;
}

function CardSubagents({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, titleOf } = ctx;
  const subagents = detail.subagents;
  if (!subagents.active && subagents.runs.length === 0 && subagents.notifications.length === 0) return null;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  return (
    <div className="debug-block">
      <div className="debug-subhead">
        <span>{t("debug.server.subagents")}</span>
        {subagents.active && <Chip tone="accent">{t("debug.server.subagentsActive")}</Chip>}
      </div>
      {subagents.runs.map((run, index) => (
        <div key={`${run.sessionId}:${index}`} className="debug-run-line">
          <RunIcon status={run.status} />
          <span className="debug-run-name">{titleOf(run.sessionId) ?? run.profile ?? shortDebugId(run.sessionId)}</span>
          <span className="debug-line">
            {join([
              translateDebugCode(run.status, DEBUG_RUN_STATUS_KEYS, t),
              run.background && t("debug.server.background"),
              run.resumed && t("debug.server.resumed"),
              run.dispatchedAt !== null && ago(run.dispatchedAt),
            ])}
          </span>
          {run.abortRequested && <Chip tone="warning">{t("debug.server.abortRequested")}</Chip>}
          {run.mcpWaiting && <Chip tone="warning">{t("debug.run.waitingForMcp")}</Chip>}
        </div>
      ))}
      {subagents.notifications.map((notification, index) => (
        <div key={`${notification.sessionId}:${index}`} className="debug-line is-warning">
          {join([
            t("debug.server.notifying", { parent: shortDebugId(notification.parentSessionId) }),
            notification.since !== null && ago(notification.since),
          ])}
        </div>
      ))}
    </div>
  );
}

function CardMcp({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t } = ctx;
  const mcp = detail.mcp;
  if (!mcp || (mcp.servers.length === 0 && mcp.problems === 0)) return null;
  const release = mcp.idleReleaseAt !== null && mcp.idleMs > 0 ? clock.remaining(mcp.idleReleaseAt) : null;
  return (
    <div className="debug-block">
      <div className="debug-pills">
        <span className={`debug-subhead${mcp.active ? "" : " is-dim"}`}>MCP</span>
        {mcp.servers.map((mcpServer, index) => {
          const { tone, filled } = mcpServerTone(mcpServer);
          const stateWord = translateDebugCode(mcpServer.state, MCP_SESSION_STATE_KEYS, t);
          const label = join([
            `${mcpServer.name} (${mcpServer.scope})`,
            stateWord,
            mcpServer.released && t("debug.server.mcpReleased"),
            mcpServer.hasError && t("debug.server.mcpError"),
          ]);
          // Any state but connected also in words, and an error on a connected one: the dot's
          // amber and red alone are a hue.
          const word = mcpServer.state !== "connected" ? stateWord : mcpServer.hasError ? t("debug.server.mcpError") : null;
          return (
            <span key={`${mcpServer.scope}:${mcpServer.name}:${index}`} className="debug-pill" role="img" aria-label={label} title={label}>
              <Dot tone={tone} ring={!filled} />
              <span className={mcpServer.released ? "is-dim" : undefined}>{mcpServer.name}</span>
              {word && <span className="debug-pill-state">{`· ${word}`}</span>}
            </span>
          );
        })}
        {mcp.problems > 0 && <Chip tone="warning">{t("debug.server.mcpProblems", { count: mcp.problems })}</Chip>}
        {mcp.disposed && <Chip tone="dim">{t("debug.server.mcpDisposed")}</Chip>}
      </div>
      {release !== null && (
        <div className="debug-idle-row">
          <Bar fraction={barFraction(release, mcp.idleMs) ?? 0} tone="dim" width={80} />
          <span className="debug-value is-muted">{t("debug.server.mcpRelease", { time: formatCountdown(release, t) })}</span>
        </div>
      )}
    </div>
  );
}

// ── C2b. Sessions on the server ──

function SessionList({ reply, detail, groups, sources, ctx }: {
  reply: DebugSnapshotResponse | null;
  /** The chat's session in full: its row shows the holders the summaries lack. */
  detail: DebugSessionDetail | null;
  groups: readonly DebugSessionGroup[] | null;
  sources: DebugPageReading["sources"];
  ctx: Ctx;
}) {
  const { t, clock } = ctx;
  let body: ReactNode;
  if (!reply || !clock || !groups) body = <div className="debug-empty">{t("debug.poll.waiting")}</div>;
  else if (groups.length === 0) body = <div className="debug-empty">{t("debug.none")}</div>;
  else {
    body = groups.map((group) => (
      <div key={group.key} className="debug-group">
        <div className="debug-group-head">
          {group.name !== null && <FolderIcon size={11} />}
          <span className="debug-group-name">{group.name ?? t("debug.sessions.unlisted")}</span>
          <span className="debug-group-count">{group.rows.filter((row) => row.summary !== null).length}</span>
        </div>
        {group.rows.map((row) => (
          <SessionRow
            key={row.id}
            row={row}
            sources={sources}
            idleTimeoutMs={reply.server.idleTimeoutMs}
            clock={clock}
            ctx={ctx}
            badges={row.current && detail?.sessionId === row.id
              ? <DetailBadges detail={detail} clock={clock} ctx={ctx} />
              : undefined}
          />
        ))}
      </div>
    ));
  }
  return (
    <div className="debug-list">
      <span className="debug-section-title">{t("debug.section.sessions")}</span>
      {body}
    </div>
  );
}

function SessionRow({ row, sources, idleTimeoutMs, clock, ctx, badges }: {
  row: DebugSessionRow;
  sources: DebugPageReading["sources"];
  idleTimeoutMs: number;
  clock: DebugServerClock;
  ctx: Ctx;
  /** The chat's row: its badges from the session's detail rather than the summary's counts. */
  badges?: ReactNode;
}) {
  const { t } = ctx;
  const summary = row.summary;
  const name = row.info ? sessionRowTitle(row.info) : shortDebugId(row.id);
  const remaining = summary && summary.nextIdleCheckAt !== null ? clock.remaining(summary.nextIdleCheckAt) : null;
  const state = summary ? debugStatusState(summary) : null;
  const className = ["debug-row", row.depth === 1 && "is-sub", row.current && "is-current", row.placeholder && "is-placeholder"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={className}
      title={join([row.current && t("debug.sessions.current"), summary ? debugSessionTitle(summary, remaining, t) : name])}
    >
      {/* The chat's row: the sidebar's mark of the selected session, its state in the card above. */}
      <span className="debug-row-status">{!row.current && state && <StatusSlot state={state} label={t(DEBUG_STATUS_KEYS[state])} />}</span>
      <span className="debug-row-title">
        {row.depth === 1 && <span className="debug-row-branch" aria-hidden="true" />}
        <span className="debug-row-name">{name}</span>
        {summary && summary.starts > 1 && <span className="debug-row-starts">{`↻${summary.starts}`}</span>}
      </span>
      {summary && (
        <SessionRowCells
          summary={summary}
          mine={pageAgentStreamCount(sources, row.id)}
          remaining={remaining}
          idleTimeoutMs={idleTimeoutMs}
          t={t}
          badges={badges}
        />
      )}
    </div>
  );
}

function SessionRowCells({ summary, mine, remaining, idleTimeoutMs, t, badges }: {
  summary: DebugSessionSummary;
  badges?: ReactNode;
  /** This page's streams for the session: the first badges are filled. */
  mine: number;
  remaining: number | null;
  idleTimeoutMs: number;
  t: Translate;
}) {
  const streamsLabel = t("debug.overlay.streams", { count: summary.eventStreams });
  const ours = Math.min(summary.eventStreams, mine);
  const streams: BadgeItem[] = Array.from({ length: summary.eventStreams }, (_, index) => (
    index < ours ? { tone: "accent", filled: true, title: streamsLabel } : { tone: "muted", title: streamsLabel }
  ));
  // The summary holds no holders and no provider names: outlined, and the generic word.
  const providersLabel = t("debug.overlay.providers", { count: summary.providers });
  const providers: BadgeItem[] = Array.from({ length: summary.providers }, () => ({ tone: "muted", title: providersLabel }));
  const idleShown = remaining !== null && (idleTimeoutMs > 0 || summary.forcedByStop);
  const idleTone: DebugTone = summary.forcedByStop ? "warning" : "dim";
  const forcedLabel = remaining !== null ? t("debug.overlay.closesIn", { time: formatShortDebugDuration(remaining, t) }) : undefined;
  return (
    <>
      {/* One cell for both runs: a second line under the title in a narrow panel. */}
      <span className="debug-row-badges">
        {badges ?? (
          <>
            <BadgeRun text="SSE" items={streams} cap={3} label={streamsLabel} />
            <BadgeRun text={t("debug.box.provider")} items={providers} cap={1} label={providersLabel} />
          </>
        )}
      </span>
      <span className={`debug-row-idle is-${idleTone}`}>
        {idleShown && remaining !== null && (
          <>
            {idleTimeoutMs > 0 && (
              <Bar fraction={barFraction(remaining, idleTimeoutMs) ?? 0} tone={idleTone} width={36} height={3} className="debug-row-idle-bar" />
            )}
            {/* Closing after Stop, at every width: a stop square, not the amber alone. */}
            {summary.forcedByStop && <span className="debug-row-forced" role="img" aria-label={forcedLabel} title={forcedLabel} />}
            <span className="debug-row-idle-text">{formatShortDebugDuration(remaining, t)}</span>
          </>
        )}
      </span>
    </>
  );
}

// ── C3. Server · global ──

function GlobalStrip({ reply, ctx }: { reply: DebugSnapshotResponse | null; ctx: Ctx }) {
  const { t, clock, myHolder } = ctx;
  if (!reply || !clock) {
    return (
      <div className="debug-strip">
        <span className="debug-section-title debug-strip-title">{t("debug.section.global")}</span>
        <span>{t("debug.poll.waiting")}</span>
      </div>
    );
  }
  const global = reply.server;
  const wrappers = t("debug.global.wrappersValue", { ...global.wrappers });
  const timers = `${t("debug.global.timers")}: ${t("debug.global.timersValue", {
    idle: global.idleTimeoutMs > 0 ? formatDebugDuration(global.idleTimeoutMs, t) : t("debug.server.idleDisabled"),
    heartbeat: formatDebugDuration(global.heartbeatMs, t),
  })}\n${wrappers}`;
  const holders = thisPageFirst(global.eventStreams.byHolder, myHolder);
  const streamsLabel = `SSE: ${t("debug.global.streamsValue", { total: global.eventStreams.total, pages: global.eventStreams.byHolder.length })}`;
  const terminals = global.terminals;
  const terminalsLabel = join([
    `${t("debug.global.terminals")}: ${t("debug.global.terminalsValue", {
      count: terminals.count,
      listeners: terminals.listeners,
      detached: terminals.detached,
      exited: terminals.exited,
    })}`,
    terminals.nextCleanupAt !== null && t("debug.global.cleanup", { time: formatCountdown(clock.remaining(terminals.nextCleanupAt), t) }),
  ]);
  // Detached shells first (dashed), then exited ones (faint), then the rest.
  const terminalItems: BadgeItem[] = Array.from({ length: terminals.count }, (_, index) => {
    if (index < terminals.detached) return { tone: "dim", dashed: true, title: terminalsLabel };
    if (index < terminals.detached + terminals.exited) return { tone: "muted", faded: true, title: terminalsLabel };
    return { tone: "muted", title: terminalsLabel };
  });
  const watchesLabel = `${t("debug.global.fileWatches")}: ${global.fileWatches}`;
  const starting = global.wrappers.starting;
  return (
    <div className="debug-strip">
      <span className="debug-section-title debug-strip-title">{t("debug.section.global")}</span>
      <span className="debug-strip-item" title={timers}>
        <Glyph kind="server" />
        <span>{`${t("debug.global.uptime")} ${formatDebugDuration(clock.age(global.startedAt), t)}`}</span>
      </span>
      {/* Wrappers still starting: the status slot's dashed ring each, as on the card. */}
      {starting > 0 && (
        <span className="debug-run" role="img" aria-label={wrappers} title={wrappers}>
          {Array.from({ length: Math.min(starting, 4) }, (_, index) => (
            <span key={index} className="debug-status"><span className="debug-status-ring is-starting" /></span>
          ))}
          {starting > 4 && <span className="debug-run-more">{`+${starting - 4}`}</span>}
        </span>
      )}
      {holders.length > 0 && (
        <span className="debug-strip-item" role="img" aria-label={streamsLabel} title={streamsLabel}>
          {holders.map((entry, index) => {
            const tone = debugHolderTone(entry.holder, myHolder);
            const label = join([debugHolderLabel(entry.holder, myHolder, t), t("debug.global.streamCount", { count: entry.count })]);
            return (
              <Fragment key={`${entry.holder ?? ""}:${index}`}>
                {index > 0 && <span className="debug-divider" />}
                <BadgeRun
                  text="SSE"
                  items={Array.from({ length: entry.count }, () => ({ tone, filled: entry.holder !== null && entry.holder === myHolder, title: label }))}
                  cap={4}
                  label={label}
                  plain
                />
              </Fragment>
            );
          })}
        </span>
      )}
      <BadgeRun
        text={t("debug.box.file")}
        items={Array.from({ length: global.fileWatches }, () => ({ tone: "muted" as const, title: watchesLabel }))}
        cap={4}
        label={watchesLabel}
      />
      <BadgeRun text={t("debug.box.terminal")} items={terminalItems} cap={4} label={terminalsLabel} />
    </div>
  );
}

// The session info popover's look (AppShell): the panel's background, a border below. Tones are
// classes setting `color`, and every mark is drawn in currentColor. No transitions: bars and rings
// jump once a second. Narrow rules follow the panel's own width, not the window's.
const DEBUG_PANEL_CSS = `
  .debug-panel {
    --dbg-ok: #16a34a;
    --dbg-warn: #d97706;
    --dbg-err: #ef4444;
    container-type: inline-size;
    container-name: debug-panel;
    display: flex;
    max-height: min(720px, 80dvh);
    flex-direction: column;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    box-shadow: 0 10px 28px rgba(0,0,0,0.10);
    color: var(--text);
  }
  .debug-panel .is-ok { color: var(--dbg-ok); }
  .debug-panel .is-warning { color: var(--dbg-warn); }
  .debug-panel .is-error { color: var(--dbg-err); }
  .debug-panel .is-accent { color: var(--accent); }
  .debug-panel .is-muted { color: var(--text-muted); }
  .debug-panel .is-dim { color: var(--text-dim); }
  .debug-panel-header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .debug-panel-heading {
    flex-shrink: 0;
    color: var(--text);
    cursor: help;
    font-weight: 700;
  }
  .debug-panel-status {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  .debug-panel-status svg {
    flex-shrink: 0;
  }
  .debug-panel-status-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-panel-copy {
    flex-shrink: 0;
    margin-left: auto;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
  }
  .debug-panel-copy:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .debug-panel-scroll {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    padding: 10px 16px 12px;
    font-size: 12px;
    line-height: 1.5;
  }
  .debug-section-title {
    color: var(--text);
    font-size: 11px;
    font-weight: 700;
  }
  .debug-empty,
  .debug-note {
    color: var(--text-dim);
    font-size: 12px;
  }
  .debug-label {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .debug-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .debug-line {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .debug-panel .debug-line.is-warning {
    color: var(--dbg-warn);
  }

  .debug-issues {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .debug-issue {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 8px;
    border-left: 2px solid currentColor;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 8%, var(--bg-panel));
  }
  .debug-issue > svg {
    flex-shrink: 0;
    margin-top: 3px;
  }
  .debug-issue-text {
    min-width: 0;
    color: var(--text);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  /* Four tiles in a row, the session's a little wider; two per row on a narrower panel, one on a phone. */
  .debug-tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.3fr);
    gap: 10px 20px;
  }
  .debug-tile,
  .debug-card,
  .debug-list,
  .debug-block {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }
  .debug-block {
    gap: 4px;
  }
  .debug-tile-head {
    display: flex;
    min-height: 18px;
    align-items: center;
    gap: 8px;
  }
  .debug-tile-value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .debug-measures {
    display: grid;
    grid-template-columns: max-content max-content max-content;
    justify-content: start;
    align-items: center;
    gap: 4px 8px;
  }
  /* Numbers line up on the right, as the count in a tile's head does. */
  .debug-measures > .debug-value {
    justify-self: end;
    text-align: right;
  }
  .debug-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .debug-chip {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 9px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  }

  /* A boxed word: "SSE", a provider's name, File, Term. Filled is this page's own. */
  .debug-badge {
    display: inline-flex;
    height: 16px;
    box-sizing: border-box;
    flex-shrink: 0;
    align-items: center;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    background-clip: padding-box;
    font: 600 10px/14px var(--font-mono);
    white-space: nowrap;
  }
  .debug-panel .debug-badge.is-filled {
    border-color: var(--accent);
    background-color: var(--accent);
    color: var(--accent-contrast);
  }
  /* This page's, amber: a stream of its own still starting or dropping events. */
  .debug-panel .debug-badge.is-filled.is-warning {
    border-color: var(--dbg-warn);
    background-color: var(--dbg-warn);
    color: var(--bg-panel);
  }
  .debug-badge.is-dashed {
    border-style: dashed;
  }
  .debug-badge.is-faded {
    opacity: 0.45;
  }
  /* A provider's name: twelve characters, then an ellipsis (a block, so the ellipsis applies). */
  .debug-badge.is-name {
    display: inline-block;
    max-width: calc(12ch + 10px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .debug-run {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 3px;
    vertical-align: middle;
  }
  .debug-run-more {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 16px;
  }

  .debug-meter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .debug-meter {
    display: flex;
    min-height: 18px;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
  }
  .debug-slot {
    display: inline-flex;
    min-width: 32px;
    height: 18px;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
  }
  .debug-slot.is-empty {
    border: 1px dotted var(--border);
  }
  .debug-meter.is-inline .debug-slot {
    min-width: 0;
    height: 16px;
  }
  .debug-meter-overflow {
    margin-left: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .debug-spark {
    display: inline-flex;
    width: 120px;
    height: 15px;
  }
  .debug-spark svg {
    display: block;
  }
  .debug-bar {
    position: relative;
    display: inline-block;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 2px;
    background: var(--border);
    vertical-align: middle;
  }
  .debug-bar-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    background: currentColor;
  }
  .debug-bar-notch {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--bg-panel);
  }
  .debug-ring {
    display: inline-flex;
  }
  .debug-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: currentColor;
  }
  .debug-dot.is-ring {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }

  .debug-status {
    display: inline-flex;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }
  .debug-status-ring {
    width: 7px;
    height: 7px;
    box-sizing: border-box;
    border: 1.5px solid var(--text-dim);
    border-radius: 50%;
  }
  .debug-status-ring.is-closing {
    border-style: dashed;
    border-color: var(--dbg-warn);
  }
  .debug-status-ring.is-none {
    border-style: dotted;
    border-color: var(--text-dim);
  }
  .debug-status-ring.is-starting {
    border-style: dashed;
  }

  .debug-server {
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .debug-card-head {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .debug-card-title {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-card-id,
  .debug-starts {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .debug-idle-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .debug-idle-bar {
    min-width: 60px;
    flex: 0 1 auto;
  }
  .debug-subhead {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 11px;
    font-weight: 700;
  }
  .debug-panel .debug-subhead.is-dim {
    color: var(--text-dim);
  }
  .debug-run-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }
  .debug-run-icon {
    display: inline-flex;
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }
  .debug-run-icon svg {
    width: 12px;
    height: 12px;
  }
  .debug-run-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
  }
  .debug-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .debug-pill-state {
    color: var(--text-dim);
    white-space: nowrap;
  }

  .debug-group {
    display: flex;
    flex-direction: column;
  }
  .debug-group-head {
    display: flex;
    min-height: 22px;
    align-items: center;
    gap: 5px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .debug-group-head svg {
    flex-shrink: 0;
  }
  .debug-group-name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-group-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .debug-row {
    display: grid;
    min-height: 24px;
    /* The title keeps room for a few characters; the badges wrap before they take it all. */
    grid-template-columns: 14px minmax(96px, 1fr) auto 76px;
    align-items: center;
    column-gap: 6px;
    padding: 0 4px;
    border-radius: 4px;
  }
  .debug-row.is-current {
    position: relative;
    background: var(--bg-selected);
  }
  /* The sidebar's mark of the selected session (app/sidebar.css): a short bar on the left edge,
     on the first line however many lines the row takes. */
  .debug-row.is-current::before {
    content: "";
    position: absolute;
    top: 5px;
    left: 0;
    width: 3px;
    height: 14px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }
  .debug-row-status {
    display: inline-flex;
    width: 14px;
    justify-content: center;
  }
  .debug-row-title {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
  }
  .debug-row.is-sub .debug-row-title {
    padding-left: 16px;
  }
  .debug-row-branch {
    position: absolute;
    top: calc(50% - 8px);
    left: 4px;
    width: 8px;
    height: 8px;
    border-bottom: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }
  .debug-row-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .debug-row.is-sub .debug-row-name {
    color: var(--text-muted);
  }
  .debug-row.is-current .debug-row-name {
    font-weight: 600;
  }
  .debug-row.is-placeholder .debug-row-name {
    color: var(--text-dim);
  }
  .debug-row-starts {
    flex-shrink: 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .debug-row-badges {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 3px 8px;
  }
  .debug-row-idle {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }
  .debug-row-forced {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 1px;
    background: currentColor;
  }
  .debug-row-idle-text {
    min-width: 3ch;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .debug-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
  }
  .debug-strip-item {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 4px;
  }
  .debug-divider {
    display: inline-block;
    width: 1px;
    height: 12px;
    align-self: center;
    margin: 0 3px;
    background: var(--border);
  }

  @container debug-panel (max-width: 900px) {
    .debug-tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container debug-panel (max-width: 520px) {
    .debug-tiles {
      grid-template-columns: minmax(0, 1fr);
    }
    .debug-card-id {
      display: none;
    }
    .debug-row {
      grid-template-columns: 14px minmax(0, 1fr) 32px;
    }
    /* The badges take a line of their own under the title, which keeps its width. */
    .debug-row-badges {
      grid-column: 2 / -1;
      grid-row: 2;
      flex-wrap: wrap;
      justify-content: flex-start;
      padding-bottom: 4px;
    }
    .debug-row.is-sub .debug-row-badges {
      padding-left: 16px;
    }
    .debug-row-badges:empty {
      display: none;
    }
    .debug-row-idle-bar {
      display: none;
    }
    .debug-strip-title {
      flex-basis: 100%;
    }
  }
`;
