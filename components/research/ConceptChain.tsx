"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { summarizeExplanation, type ResearchNode } from "@/lib/term-research";
import type { TermResearch } from "@/hooks/useTermResearch";

interface NodeViewProps {
  node: ResearchNode;
  depth: number;
  childrenOf: Map<string | null, ResearchNode[]>;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}

function ChainNodeView({ node, depth, childrenOf, onOpen, onRemove }: NodeViewProps) {
  const { t } = useI18n();
  const children = childrenOf.get(node.id) ?? [];
  const isLoading = node.status === "loading";
  const summary = node.status === "error" ? (node.error ?? "") : summarizeExplanation(node.explanation);
  const followupCount = (node.followups ?? []).length;

  return (
    <div className="research-chain-node" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      {depth > 0 && <div className="research-chain-edge" aria-hidden="true" />}
      <div className="group relative">
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          title={`${node.term}\n${summary}`}
          className="research-chain-item"
          data-status={node.status}
        >
          <span className={`research-status-dot ${node.status === "done" ? "is-done" : ""} ${node.status === "error" ? "is-error" : ""}`} aria-hidden="true">
            {isLoading && (
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={`truncate text-[12px] font-semibold leading-tight ${node.status === "error" ? "text-[#f87171]" : "text-[var(--text)]"}`}>
                {node.term}
              </span>
              {children.length > 0 && (
                <span className="flex-shrink-0 rounded bg-[var(--bg-subtle)] px-1 text-[9px] leading-4 text-[var(--text-dim)]">
                  +{children.length}
                </span>
              )}
              {followupCount > 0 && (
                <span
                  className="research-chain-followup-badge"
                  title={node.followups?.map((f) => `Q: ${f.question}`).join("\n")}
                >
                  {t("research.followupBadge", { n: followupCount })}
                </span>
              )}
            </span>
            {summary && (
              <span className={`mt-0.5 block truncate text-[10px] leading-snug ${node.status === "error" ? "text-[#f87171]" : "text-[var(--text-dim)]"}`}>
                {summary}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onRemove(node.id)}
          title={t("research.remove")}
          aria-label={t("research.remove")}
          className="research-chain-remove"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {children.length > 0 && (
        <div className="research-chain-children">
          {children.map((child) => (
            <ChainNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  research: TermResearch;
  /** Open a node's card (with a locate flash), wired by the overlay. */
  onOpen: (id: string) => void;
}

/**
 * Floating "concept chain" panel: the research path as a tree of term
 * lookups, each with a one-line summary. Clicking a node re-opens and
 * flashes its explanation card; subtrees can be pruned and the whole chain
 * exported as a Markdown note.
 */
export function ConceptChain({ research, onOpen }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, ResearchNode[]>();
    for (const node of research.nodes) {
      const key = node.parentId && research.byId.has(node.parentId) ? node.parentId : null;
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return map;
  }, [research.nodes, research.byId]);

  const roots = childrenOf.get(null) ?? [];

  const handleExportMarkdown = () => research.exportMarkdown();
  const handleExportMindmap = () => research.exportMindmap();
  const handleExportAnki = () => research.exportAnki();
  const handleClear = () => {
    if (window.confirm(t("research.clearConfirm"))) research.clearAll();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={t("research.chainTitle")}
        aria-expanded={expanded}
        aria-label={t("research.chainTitle")}
        className="research-chain-toggle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="19" cy="6" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path d="M7 11 17 6.8" />
          <path d="M7 13 17 17.2" />
        </svg>
        {research.nodes.length > 0 && (
          <span className="research-chain-badge">{research.nodes.length}</span>
        )}
      </button>

      {expanded && (
        <div className="research-chain-panel">
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[12px] font-semibold text-[var(--text)]">
                {t("research.chainTitle")}
              </span>
              {research.nodes.length > 0 && (
                <span className="text-[9px] text-[var(--text-dim)]">
                  {t("research.chainStats", { terms: research.nodes.length, chains: roots.length })}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={research.nodes.length === 0}
              title={t("research.export")}
              aria-label={t("research.export")}
              className="grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M4 19h16" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleExportMindmap}
              disabled={research.nodes.length === 0}
              title={t("research.exportMindmap")}
              aria-label={t("research.exportMindmap")}
              className="grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="5" rx="1" /><rect x="2" y="16" width="6" height="5" rx="1" /><rect x="16" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M12 12H5v4M12 12h7v4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleExportAnki}
              disabled={research.nodes.length === 0}
              title={t("research.exportAnki")}
              aria-label={t("research.exportAnki")}
              className="grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="14" height="12" rx="2" /><path d="M7 3h14v12" /><path d="M7 9h6M7 12h4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={research.nodes.length === 0}
              title={t("research.clear")}
              aria-label={t("research.clear")}
              className="grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[#f87171] disabled:cursor-default disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              title={t("research.close")}
              aria-label={t("research.close")}
              className="grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[var(--text)]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {roots.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-[var(--text-dim)]">
                {t("research.chainEmpty")}
              </div>
            ) : (
              roots.map((root, index) => (
                <div key={root.id}>
                  {index > 0 && <div className="research-chain-divider" aria-hidden="true" />}
                  <ChainNodeView
                    node={root}
                    depth={0}
                    childrenOf={childrenOf}
                    onOpen={onOpen}
                    onRemove={research.removeSubtree}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
