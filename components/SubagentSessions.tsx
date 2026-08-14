"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, CircleStop, Network, Send } from "lucide-react";
import type { SubagentLifecycleState, SubagentTreeNode } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";

// ============================================================================
// Subagent header action, tree, breadcrumb, and composer.
//
// The popover shell (positioning, backdrop, focus return) lives in AppShell;
// these components render content only. The tree is complete for the root even
// when a descendant is selected; runtime placeholders stay disabled.
// ============================================================================

export interface SubagentTreeCallbacks {
  onSelect(node: SubagentTreeNode): void;
  onControl(action: "steer" | "interrupt" | "resume", childSessionId: string, message?: string): Promise<void>;
}

export function SubagentHeaderAction({
  count,
  open,
  live,
  onOpen,
}: {
  count: number;
  open: boolean;
  live: boolean;
  onOpen(anchor: HTMLButtonElement): void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("subagents.open", { count })}
      aria-pressed={open}
      title={t("subagents.title")}
      onClick={(event) => onOpen(event.currentTarget)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 8px",
        minHeight: 30,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: open ? "var(--bg-selected)" : "transparent",
        color: open ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      <Network size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>{count}</span>
      {live ? (
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      ) : null}
    </button>
  );
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

export function SubagentTree({
  nodes,
  selectedSessionId,
  callbacks,
}: {
  nodes: SubagentTreeNode[];
  selectedSessionId: string | null;
  callbacks: SubagentTreeCallbacks;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleNodes = useMemo(() => getVisibleNodes(nodes, collapsed), [nodes, collapsed]);
  const depthById = useMemo(() => {
    const depths = new Map<string, number>();
    const stack: Array<[SubagentTreeNode, number]> = nodes.map((node) => [node, 0]);
    while (stack.length) {
      const [current, depth] = stack.pop()!;
      depths.set(nodeId(current), depth);
      for (const child of current.children) stack.push([child, depth + 1]);
    }
    return depths;
  }, [nodes]);

  // Keep the roving focus index inside the visible list.
  useEffect(() => {
    setFocusIndex((current) => Math.min(current, Math.max(0, visibleNodes.length - 1)));
  }, [visibleNodes.length]);
  useEffect(() => {
    rowRefs.current[focusIndex]?.focus({ preventScroll: true });
  }, [focusIndex]);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (visibleNodes.length === 0) return;
    const index = focusIndex;
    const current = visibleNodes[index];
    if (!current) return;
    const id = nodeId(current);
    const hasChildren = current.children.length > 0;
    const isCollapsed = collapsed.has(id);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocusIndex(Math.min(index + 1, visibleNodes.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusIndex(Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setFocusIndex(0);
        break;
      case "End":
        event.preventDefault();
        setFocusIndex(visibleNodes.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && isCollapsed) toggle(id);
        else if (hasChildren && !isCollapsed && index + 1 < visibleNodes.length) setFocusIndex(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (hasChildren && !isCollapsed) toggle(id);
        else if (index > 0) setFocusIndex(Math.max(0, index - 1));
        break;
      case "Enter":
        event.preventDefault();
        if (current.sessionId !== null) callbacks.onSelect(current);
        break;
    }
  }, [visibleNodes, focusIndex, collapsed, toggle, callbacks]);

  const activity = (node: SubagentTreeNode): string => {
    if (node.activity) return node.activity;
    if (node.state === "running") return t("subagents.activity.running");
    return "";
  };

  return (
    <div
      role="tree"
      aria-label={t("subagents.title")}
      onKeyDown={handleKeyDown}
      style={{ display: "flex", flexDirection: "column", gap: 2, padding: 4, overflowY: "auto" }}
    >
      {visibleNodes.length === 0 ? (
        <div style={{ padding: "10px 8px", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>
          {t("subagents.empty")}
        </div>
      ) : (
        visibleNodes.map((node, index) => {
          const id = nodeId(node);
          const hasChildren = node.children.length > 0;
          const disabled = node.sessionId === null;
          const selected = node.sessionId !== null && node.sessionId === selectedSessionId;
          const elapsed = node.elapsedMs !== undefined ? formatElapsed(node.elapsedMs) : "";
          const detail = [node.agent, t(stateLabelKey(node.state)), activity(node), elapsed].filter(Boolean).join(" · ");
          const depth = depthById.get(id) ?? 0;
          const accessibleDetail = [node.task, t(stateLabelKey(node.state)), activity(node), elapsed].filter(Boolean).join(", ");
          return (
            <div
              key={id}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? !collapsed.has(id) : undefined}
              aria-selected={selected}
              style={{ display: "flex", alignItems: "center", minHeight: 36, paddingLeft: depth * 14 }}
            >
              <button
                ref={(element) => { rowRefs.current[index] = element; }}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                disabled={disabled}
                aria-current={selected ? "true" : undefined}
                aria-label={accessibleDetail}
                data-subagent-card-row="true"
                onClick={() => { if (!disabled) callbacks.onSelect(node); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 36,
                  padding: "4px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: selected ? "var(--bg-selected)" : "transparent",
                  color: disabled ? "var(--text-dim)" : "var(--text)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
              >
                <span aria-hidden="true" className="subagent-state-dot" data-subagent-state={node.state} />
                {hasChildren ? (
                  <span
                    role="presentation"
                    onClick={(event) => { event.stopPropagation(); toggle(id); }}
                    style={{ display: "inline-flex", cursor: "pointer", color: "var(--text-muted)" }}
                  >
                    <ChevronRight
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      style={{ transform: collapsed.has(id) ? "none" : "rotate(90deg)", transition: "transform 0.15s" }}
                    />
                  </span>
                ) : (
                  <span style={{ width: 12, flexShrink: 0 }} />
                )}
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      color: disabled ? "var(--text-dim)" : "var(--text)",
                    }}
                  >
                    {node.task}
                  </span>
                  {detail ? (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 11 }}>
                      {detail}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          );
        })
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
  if (nodes.length === 0) return null;
  const totalCount = countSubagentNodes(nodes);
  const activeCount = countActiveSubagentNodes(nodes);
  return (
    <section className="desktop-subagent-card" aria-label={t("subagents.title")} data-subagent-card="true">
      <div className="desktop-subagent-card-header">
        <Network size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>
          {totalCount} {t("subagents.title").toLowerCase()}
        </span>
        {rpcAvailable && activeCount > 0 ? (
          <span className="desktop-subagent-card-live" aria-hidden="true" />
        ) : null}
        {activeCount > 0 ? (
          <span className="desktop-subagent-card-summary">
            {t("subagents.runningSummary", { count: activeCount })}
          </span>
        ) : null}
      </div>
      {stale ? (
        <div className="desktop-subagent-card-stale">{t("subagents.stale")}</div>
      ) : null}
      <SubagentTree
        nodes={nodes}
        selectedSessionId={selectedSessionId}
        callbacks={callbacks}
      />
    </section>
  );
}

/** Ancestor chain from the root to the selected node, from the tree alone. */
export function buildBreadcrumbItems(
  nodes: SubagentTreeNode[],
  selectedSessionId: string,
  rootLabel: string,
): BreadcrumbItem[] {
  const selected = findSubagentNode(nodes, selectedSessionId);
  if (!selected) return [];
  const chain: BreadcrumbItem[] = [{ id: "", label: rootLabel }];
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
      chain.push({ id: node.sessionId, label: node.task });
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
        fontSize: 12,
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
                fontSize: 12,
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
          fontSize: 12,
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
        alignItems: "flex-end",
        gap: 8,
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
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
          flex: 1,
          minHeight: 34,
          maxHeight: 120,
          resize: "none",
          padding: "7px 10px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 13,
          lineHeight: 1.4,
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
            width: 34,
            height: 34,
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
          minHeight: 34,
          padding: "0 12px",
          flexShrink: 0,
          border: "none",
          borderRadius: 8,
          background: "var(--accent)",
          color: "var(--bg)",
          cursor: busy || value.trim().length === 0 ? "not-allowed" : "pointer",
          opacity: busy || value.trim().length === 0 ? 0.55 : 1,
          fontSize: 13,
        }}
      >
        <Send size={13} strokeWidth={2} aria-hidden="true" />
        {action === "resume" ? t("subagents.resume") : t("subagents.steer")}
      </button>
      {error ? (
        <div role="alert" style={{ color: "#dc2626", fontSize: 12, flex: "0 0 100%" }}>{error}</div>
      ) : null}
    </div>
  );
}
