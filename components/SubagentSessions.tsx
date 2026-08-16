"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, CircleStop, Network, Send } from "lucide-react";
import type { SubagentLifecycleState, SubagentTreeNode } from "@/lib/api-types";
import type { ExtensionWidgetItem } from "@/lib/types";
import { stripAnsi } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { hasActiveDescendant } from "@/hooks/useSubagentTree";
import { formatExtensionWidgetContent } from "./ExtensionWidgets";

// ============================================================================
// Subagent tree, breadcrumb, and composer.
//
// The popover shell (positioning, backdrop, focus return) lives in AppShell;
// these components render content only. The tree is complete for the root even
// when a descendant is selected; runtime placeholders stay disabled.
// ============================================================================

export interface SubagentTreeCallbacks {
  onSelect(node: SubagentTreeNode): void;
  onControl(action: "steer" | "interrupt" | "resume", childSessionId: string, message?: string): Promise<void>;
}

export const ACTIVE_ROW_STATES: ReadonlySet<SubagentLifecycleState> = new Set([
  "starting",
  "queued",
  "running",
  "needs_attention",
]);

/** Which composer action applies to a node, if any. */
export function submitActionFor(node: SubagentTreeNode): "steer" | "resume" | null {
  if (node.sessionId === null) return null;
  if (ACTIVE_ROW_STATES.has(node.state)) return "steer";
  if (node.state === "paused") return "resume";
  return null;
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  if (minutes < 60) return `${minutes}m ${totalSec % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function stateLabelKey(state: SubagentLifecycleState): string {
  return `subagents.state.${state}`;
}

/** Visible preorder nodes honoring collapsed ids (for rendering + keyboard). */
function nodeId(node: SubagentTreeNode): string {
  return node.sessionId ?? `runtime:${node.runId}:${node.index ?? ""}`;
}

/** Visible preorder nodes honoring collapsed ids (for rendering + keyboard). */
export function getVisibleNodes(
  nodes: SubagentTreeNode[],
  collapsed: ReadonlySet<string>,
): SubagentTreeNode[] {
  const visible: SubagentTreeNode[] = [];
  const visit = (list: SubagentTreeNode[]) => {
    for (const node of list) {
      visible.push(node);
      if (node.children.length > 0 && !collapsed.has(nodeId(node))) visit(node.children);
    }
  };
  visit(nodes);
  return visible;
}

/** ARIA metadata for one visible row, for tree semantics and parent navigation. */
interface TreeRowMeta {
  depth: number;
  position: number; // 1-based index within its own sibling list
  setSize: number; // sibling list length
  parentId: string | null; // nodeId of the nearest visible ancestor, null at the root level
}

interface TreeRow {
  node: SubagentTreeNode;
  meta: TreeRowMeta;
}

/** Visible preorder rows with sibling-list metadata, honoring collapsed ids. */
function buildTreeRows(nodes: SubagentTreeNode[], collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (list: SubagentTreeNode[], parentId: string | null, depth: number) => {
    list.forEach((node, index) => {
      rows.push({ node, meta: { depth, position: index + 1, setSize: list.length, parentId } });
      if (node.children.length > 0 && !collapsed.has(nodeId(node))) {
        visit(node.children, nodeId(node), depth + 1);
      }
    });
  };
  visit(nodes, null, 0);
  return rows;
}

// Rows whose selection button is disabled cannot receive focus; roving focus
// must skip them so keyboard navigation never stalls on a placeholder.
export function nextFocusableIndex(rows: TreeRow[], from: number, direction: 1 | -1): number {
  const length = rows.length;
  for (let offset = 0; offset < length; offset += 1) {
    const index = from + direction * offset;
    if (index < 0 || index >= length) return -1;
    if (rows[index].node.sessionId !== null) return index;
  }
  return -1;
}

export function SubagentTree({
  nodes,
  selectedSessionId,
  callbacks,
  initialFocus = false,
}: {
  nodes: SubagentTreeNode[];
  selectedSessionId: string | null;
  callbacks: SubagentTreeCallbacks;
  /** Focus the first row on open (top-panel popover). The passive desktop card stays off. */
  initialFocus?: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visibleRows = useMemo(() => buildTreeRows(nodes, collapsed), [nodes, collapsed]);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    visibleRows.forEach((row, index) => map.set(nodeId(row.node), index));
    return map;
  }, [visibleRows]);

  // Keep the roving focus index inside the visible list.
  useEffect(() => {
    setFocusIndex((current) => Math.min(current, Math.max(0, visibleRows.length - 1)));
  }, [visibleRows.length]);

  // Focus the first focusable row once when the tree opens as an interactive
  // panel. The desktop card is passive: it must never steal focus from the
  // composer, so it never auto-focuses (and the guard below keeps refreshes
  // from yanking focus either). The initial jump is explicit because the
  // restore guard only fires while focus is already inside the tree.
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (!initialFocus || focusedOnceRef.current || visibleRows.length === 0) return;
    focusedOnceRef.current = true;
    const first = nextFocusableIndex(visibleRows, 0, 1);
    if (first === -1) return;
    setFocusIndex(first);
    rowRefs.current[first]?.focus({ preventScroll: true });
  }, [initialFocus, visibleRows]);

  useEffect(() => {
    // Restore roving focus only while the tree itself already holds focus
    // (keyboard navigation). A background data refresh must never move the
    // user's cursor out of the composer or any other control.
    const active = containerRef.current?.ownerDocument.activeElement ?? null;
    if (active && containerRef.current && !containerRef.current.contains(active)) return;
    const target = rowRefs.current[focusIndex];
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      return;
    }
    const forward = nextFocusableIndex(visibleRows, focusIndex, 1);
    const fallback = forward !== -1 ? forward : nextFocusableIndex(visibleRows, focusIndex, -1);
    if (fallback !== -1 && fallback !== focusIndex) {
      setFocusIndex(fallback);
    }
  }, [visibleRows, focusIndex]);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // When the whole tree settles (no live subagent remains — the task ended),
  // fold every branch so the finished hierarchy reads as a compact summary.
  // A settled snapshot is static (polling stops), so a later manual expand
  // survives until the next snapshot arrives.
  useEffect(() => {
    if (hasActiveDescendant(nodes)) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      const fold = (list: SubagentTreeNode[]) => {
        for (const node of list) {
          if (node.children.length > 0) {
            next.add(nodeId(node));
            fold(node.children);
          }
        }
      };
      fold(nodes);
      return next.size === previous.size ? previous : next;
    });
  }, [nodes]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (visibleRows.length === 0) return;
    const index = focusIndex;
    const row = visibleRows[index];
    if (!row) return;
    const { node: current, meta } = row;
    const id = nodeId(current);
    const hasChildren = current.children.length > 0;
    const isCollapsed = collapsed.has(id);

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const candidate = index + 1;
        if (candidate >= visibleRows.length) break;
        const next = visibleRows[candidate].node.sessionId === null
          ? nextFocusableIndex(visibleRows, candidate, 1)
          : candidate;
        if (next !== -1) setFocusIndex(next);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const candidate = index - 1;
        if (candidate < 0) break;
        const next = visibleRows[candidate].node.sessionId === null
          ? nextFocusableIndex(visibleRows, candidate, -1)
          : candidate;
        if (next !== -1) setFocusIndex(next);
        break;
      }
      case "Home": {
        event.preventDefault();
        const next = nextFocusableIndex(visibleRows, 0, 1);
        if (next !== -1) setFocusIndex(next);
        break;
      }
      case "End": {
        event.preventDefault();
        const next = nextFocusableIndex(visibleRows, visibleRows.length - 1, -1);
        if (next !== -1) setFocusIndex(next);
        break;
      }
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && isCollapsed) toggle(id);
        else if (hasChildren && !isCollapsed && index + 1 < visibleRows.length) setFocusIndex(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (hasChildren && !isCollapsed) toggle(id);
        else {
          const parentIndex = meta.parentId ? indexById.get(meta.parentId) : undefined;
          if (parentIndex !== undefined) setFocusIndex(parentIndex);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (current.sessionId !== null) callbacks.onSelect(current);
        break;
    }
  }, [visibleRows, indexById, focusIndex, collapsed, toggle, callbacks]);

  const activity = (node: SubagentTreeNode): string => {
    if (node.activity) return node.activity;
    if (node.state === "running") return t("subagents.activity.running");
    return "";
  };

  // One treeitem row plus, when expanded, its nested sibling group.
  const renderRow = (row: TreeRow, index: number, nested: ReactNode | null): ReactNode => {
    const { node, meta } = row;
    const id = nodeId(node);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(id);
    const disabled = node.sessionId === null;
    const selected = node.sessionId !== null && node.sessionId === selectedSessionId;
    const elapsed = node.elapsedMs !== undefined ? formatElapsed(node.elapsedMs) : "";
    const detail = [t(stateLabelKey(node.state)), activity(node), elapsed].filter(Boolean).join(" · ");
    const accessibleDetail = [node.task, t(stateLabelKey(node.state)), activity(node), elapsed].filter(Boolean).join(", ");
    return (
      <div
        key={id}
        role="treeitem"
        className="subagent-tree-item"
        aria-level={meta.depth + 1}
        aria-posinset={meta.position}
        aria-setsize={meta.setSize}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-selected={selected}
        style={{ paddingLeft: meta.depth * 14 }}
      >
        <div className="subagent-tree-item-row">
          {hasChildren ? (
            <button
              type="button"
              className="subagent-tree-disclosure"
              aria-label={isCollapsed ? t("subagents.expand") : t("subagents.collapse")}
              onClick={(event) => { event.stopPropagation(); toggle(id); }}
              tabIndex={-1}
            >
              <ChevronRight
                size={12}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{ transform: isCollapsed ? "none" : "rotate(90deg)" }}
              />
            </button>
          ) : (
            <span className="subagent-tree-disclosure" aria-hidden="true" />
          )}
          <button
            ref={(element) => { rowRefs.current[index] = element; }}
            type="button"
            className="subagent-tree-row"
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled}
            aria-current={selected ? "true" : undefined}
            aria-label={accessibleDetail}
            data-subagent-card-row="true"
            data-subagent-session-id={node.sessionId ?? undefined}
            onClick={() => { if (!disabled) { setFocusIndex(index); callbacks.onSelect(node); } }}
          >
            <span aria-hidden="true" className="subagent-state-dot" data-subagent-state={node.state} />
            <span className="subagent-tree-copy">
              <span className="subagent-tree-agent">{node.agent}</span>
              {node.task ? <span className="subagent-tree-task">{node.task}</span> : null}
              {detail ? <span className="subagent-tree-detail">{detail}</span> : null}
            </span>
          </button>
        </div>
        {nested ? (
          <div role="group" key={`${id}-group`} className="subagent-tree-group">
            {nested}
          </div>
        ) : null}
      </div>
    );
  };

  // Walks the flattened visible rows, grouping each expanded node's children.
  const renderSiblingList = (rows: TreeRow[], start: number): { content: ReactNode[]; next: number } => {
    const content: ReactNode[] = [];
    let i = start;
    while (i < rows.length) {
      const { node } = rows[i];
      const expanded = node.children.length > 0 && !collapsed.has(nodeId(node));
      let nested: ReactNode = null;
      let next = i + 1;
      if (expanded) {
        const group = renderSiblingList(rows, i + 1);
        nested = group.content;
        next = group.next;
      }
      content.push(renderRow(rows[i], i, nested));
      i = next;
    }
    return { content, next: i };
  };

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={t("subagents.title")}
      onKeyDown={handleKeyDown}
      style={{ display: "flex", flexDirection: "column", gap: 2, padding: 4, overflowX: "hidden", overflowY: "auto" }}
    >
      {visibleRows.length === 0 ? (
        <div style={{ padding: "10px 8px", color: "var(--text-muted)", fontSize: "var(--text-meta)", fontStyle: "italic" }}>
          {t("subagents.empty")}
        </div>
      ) : (
        renderSiblingList(visibleRows, 0).content
      )}
    </div>
  );
}


/** Recursively counts every subagent node in the root tree. */
export function countSubagentNodes(nodes: SubagentTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countSubagentNodes(node.children);
  }
  return count;
}

/** Recursively counts nodes in an active lifecycle state. */
export function countActiveSubagentNodes(nodes: SubagentTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (ACTIVE_ROW_STATES.has(node.state)) count += 1;
    count += countActiveSubagentNodes(node.children);
  }
  return count;
}

/** Finds a node by its durable session id anywhere in the tree. */
export function findSubagentNode(
  nodes: SubagentTreeNode[],
  sessionId: string,
): SubagentTreeNode | null {
  for (const node of nodes) {
    if (node.sessionId === sessionId) return node;
    const found = findSubagentNode(node.children, sessionId);
    if (found) return found;
  }
  return null;
}

/**
 * Compact right-gutter card for the recursive subagent tree. Visibility and
 * navigation only: controls stay in the child transcript composer.
 */
export function DesktopSubagentCard({
  nodes,
  selectedSessionId,
  rpcAvailable,
  stale,
  callbacks,
}: {
  nodes: SubagentTreeNode[];
  selectedSessionId: string | null;
  rpcAvailable: boolean;
  stale: boolean;
  callbacks: SubagentTreeCallbacks;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const totalCount = countSubagentNodes(nodes);
  const activeCount = countActiveSubagentNodes(nodes);

  // When the whole task settles, fold the card to its header so the finished
  // hierarchy stops occupying the gutter. A manual toggle still works.
  const settled = activeCount === 0;
  useEffect(() => {
    if (settled) setCollapsed(true);
  }, [settled]);

  if (nodes.length === 0) return null;

  return (
    <section
      className={collapsed ? "desktop-subagent-card is-collapsed" : "desktop-subagent-card"}
      aria-label={t("subagents.title")}
      data-subagent-card="true"
    >
      <button
        type="button"
        className="desktop-subagent-card-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <Network size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>
          {totalCount} {t("subagents.title")}
        </span>
        {rpcAvailable && activeCount > 0 ? (
          <span className="desktop-subagent-card-live" aria-hidden="true" />
        ) : null}
        {activeCount > 0 ? (
          <span className="desktop-subagent-card-summary">
            {t("subagents.runningSummary", { count: activeCount })}
          </span>
        ) : null}
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: collapsed ? "none" : "rotate(90deg)",
          }}
        />
      </button>
      {!collapsed && stale ? (
        <div className="desktop-subagent-card-stale">{t("subagents.stale")}</div>
      ) : null}
      {!collapsed ? (
        <SubagentTree
          nodes={nodes}
          selectedSessionId={selectedSessionId}
          callbacks={callbacks}
        />
      ) : null}
    </section>
  );
}

/** Right-gutter fallback when live TUI widgets exist but the RPC tree is empty. */
export function DesktopSubagentWidgetCard({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  const { t } = useI18n();
  if (widgets.length === 0) return null;
  return (
    <section
      className="desktop-subagent-card"
      aria-label={t("subagents.title")}
      data-subagent-card="true"
      data-subagent-widget-card="true"
    >
      <div className="desktop-subagent-card-header">
        <Network size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("subagents.title")}</span>
      </div>
      {widgets.map((widget) => (
        <pre key={widget.key} className="desktop-subagent-widget-content">
          {stripAnsi(formatExtensionWidgetContent(widget.lines))}
        </pre>
      ))}
    </section>
  );
}

/** Ancestor chain from the root to the selected node, from the tree alone. */
export function buildBreadcrumbItems(
  nodes: SubagentTreeNode[],
  selectedSessionId: string,
  rootSessionId: string,
  rootLabel: string,
): BreadcrumbItem[] {
  const selected = findSubagentNode(nodes, selectedSessionId);
  if (!selected) return [];
  const chain: BreadcrumbItem[] = [{ id: rootSessionId, label: rootLabel }];
  const byId = new Map<string, SubagentTreeNode>();
  const collect = (list: SubagentTreeNode[]) => {
    for (const node of list) {
      byId.set(node.sessionId ?? "", node);
      collect(node.children);
    }
  };
  collect(nodes);
  const path: SubagentTreeNode[] = [selected];
  let cursor = selected.parentSessionId ? byId.get(selected.parentSessionId) : undefined;
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentSessionId ? byId.get(cursor.parentSessionId) : undefined;
  }
  for (const node of path) {
    if (node.sessionId !== null) {
      chain.push({ id: node.sessionId, label: node.task || node.agent });
    }
  }
  return chain;
}

export interface BreadcrumbItem {

  id: string;
  label: string;
}

export function SessionBreadcrumb({
  items,
  onSelect,
}: {
  items: BreadcrumbItem[];
  onSelect(id: string): void;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Subagent breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexWrap: "wrap",
        padding: "6px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: "var(--text-ui)",
        color: "var(--text-muted)",
      }}
    >
      {items.map((item, index) => (
        <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          {index > 0 ? <ChevronRight size={11} strokeWidth={1.6} aria-hidden="true" style={{ flexShrink: 0 }} /> : null}
          {index === items.length - 1 ? (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", maxWidth: 320 }}>{item.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                maxWidth: 260,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                border: "none",
                background: "transparent",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: "var(--text-ui)",
                padding: "2px 2px",
              }}
            >
              {item.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

export function SubagentComposer({
  node,
  rpcAvailable,
  onControl,
  onInterrupt,
}: {
  node: SubagentTreeNode;
  rpcAvailable: boolean;
  onControl(action: "steer" | "resume", message: string): Promise<void>;
  onInterrupt(): Promise<void>;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = submitActionFor(node);
  const live = rpcAvailable && action !== null;

  const submit = useCallback(async () => {
    const message = value.trim();
    if (!message || !action) return;
    setBusy(true);
    setError(null);
    try {
      await onControl(action, message);
      setValue("");
    } catch (submitError) {
      // Preserve the draft so a rejected control can be retried.
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }, [value, action, onControl]);

  const interrupt = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onInterrupt();
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : String(interruptError));
    } finally {
      setBusy(false);
    }
  }, [onInterrupt]);

  if (!live) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontSize: "var(--text-meta)",
        }}
      >
        {t("subagents.readOnly")}
      </div>
    );
  }

  const placeholder = action === "resume" ? t("subagents.resumePlaceholder") : t("subagents.steerPlaceholder");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        minWidth: 0,
      }}
    >
      {error ? (
        <div
          role="alert"
          style={{ color: "#dc2626", fontSize: "var(--text-meta)", lineHeight: "var(--leading-ui)", overflowWrap: "anywhere", minWidth: 0 }}
        >
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minWidth: 0 }}>
        <textarea
          value={value}
          disabled={busy}
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            minHeight: isMobile ? 44 : 34,
            maxHeight: 120,
            resize: "none",
            padding: "7px 10px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "var(--text-ui)",
            lineHeight: "var(--leading-ui)",
          }}
        />
        {action === "steer" && node.canInterrupt ? (
          <button
            type="button"
            disabled={busy}
            aria-label={t("subagents.interrupt")}
            title={t("subagents.interrupt")}
            onClick={() => void interrupt()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: isMobile ? 44 : 34,
              height: isMobile ? 44 : 34,
              flexShrink: 0,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            <CircleStop size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || value.trim().length === 0}
          aria-label={action === "resume" ? t("subagents.resume") : t("subagents.steer")}
          onClick={() => void submit()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            minHeight: isMobile ? 44 : 34,
            padding: "0 12px",
            flexShrink: 0,
            border: "none",
            borderRadius: 8,
            background: "var(--accent)",
            color: "var(--bg)",
            cursor: busy || value.trim().length === 0 ? "not-allowed" : "pointer",
            opacity: busy || value.trim().length === 0 ? 0.55 : 1,
            fontSize: "var(--text-ui)",
          }}
        >
          <Send size={13} strokeWidth={2} aria-hidden="true" />
          {action === "resume" ? t("subagents.resume") : t("subagents.steer")}
        </button>
      </div>
    </div>
  );
}
