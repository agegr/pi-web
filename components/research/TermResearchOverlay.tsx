"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTermResearch } from "@/hooks/useTermResearch";
import { MAX_TERM_LENGTH, trimContextAround, type ResearchNode } from "@/lib/term-research";
import { MarkdownBody } from "../MarkdownBody";
import { TermCard, type TermCardPosition } from "./TermCard";
import { ConceptChain } from "./ConceptChain";

const CARD_WIDTH = 380;
const CARD_EST_HEIGHT = 340;
const TRIGGER_SIZE = 28;
const TRIGGER_OFFSET = 8;

interface SelectionTarget {
  term: string;
  rect: { top: number; left: number; bottom: number; right: number; width: number };
}

function getSelectionAnchorElement(selection: Selection): Element | null {
  const node = selection.anchorNode;
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
  return node as Element;
}

/** The card a nested selection happens inside, if any. */
function findParentNodeId(container: Element | null): string | null {
  const card = container?.closest("[data-research-node-id]");
  return card?.getAttribute("data-research-node-id") ?? null;
}

function clampTriggerX(centerX: number, viewportWidth: number): number {
  const half = TRIGGER_SIZE / 2;
  return Math.min(Math.max(half + 4, centerX - half), viewportWidth - half - 4);
}

function computeCardPosition(
  rect: SelectionTarget["rect"] | null,
  index: number,
  viewportWidth: number,
  viewportHeight: number,
): TermCardPosition {
  const width = Math.min(CARD_WIDTH, viewportWidth - 16);
  // Ignore anchors that scrolled out of the viewport entirely; clamp
  // partially visible ones so the card always lands on screen.
  if (rect && rect.bottom > 0 && rect.top < viewportHeight) {
    const top = Math.max(0, Math.min(rect.top, viewportHeight));
    const bottom = Math.max(0, Math.min(rect.bottom, viewportHeight));
    const x = Math.min(Math.max(8, rect.left), viewportWidth - width - 8);
    const below = bottom + TRIGGER_OFFSET;
    if (below + CARD_EST_HEIGHT < viewportHeight - 8) return { x, y: below };
    const above = top - CARD_EST_HEIGHT - TRIGGER_OFFSET;
    if (above > 8) return { x, y: above };
    return { x, y: Math.max(8, Math.min(bottom, viewportHeight - CARD_EST_HEIGHT - 8)) };
  }
  // Re-opened from the chain panel or stale anchor: cascade from the center.
  const x = Math.max(8, (viewportWidth - width) / 2 + (index % 5) * 28);
  const y = Math.max(8, Math.min(100 + index * 24, viewportHeight - CARD_EST_HEIGHT - 8));
  return { x, y };
}

interface LinkGeometry {
  id: string;
  d: string;
}

/**
 * Bezier arrows from each open parent card to its open child card. Measured
 * from the live DOM after every render, so dragging or streaming keeps the
 * arrow attached. Purely decorative: pointer-events disabled.
 */
function ResearchLinks({ pairs }: { pairs: Array<{ id: string; parentId: string }> }) {
  const [links, setLinks] = useState<LinkGeometry[]>([]);

  useEffect(() => {
    const next: LinkGeometry[] = [];
    for (const { id, parentId } of pairs) {
      const child = document.querySelector(`[data-research-node-id="${id}"]`);
      const parent = document.querySelector(`[data-research-node-id="${parentId}"]`);
      if (!(child instanceof HTMLElement) || !(parent instanceof HTMLElement)) continue;
      const c = child.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      const pcx = p.left + p.width / 2;
      const ccx = c.left + c.width / 2;
      let from: [number, number];
      let to: [number, number];
      if (ccx >= pcx) {
        from = [p.right, p.top + p.height / 2];
        to = [c.left, c.top + c.height / 2];
      } else {
        from = [p.left, p.top + p.height / 2];
        to = [c.right, c.top + c.height / 2];
      }
      const bend = Math.max(28, Math.abs(to[0] - from[0]) * 0.45);
      const dir = to[0] >= from[0] ? 1 : -1;
      next.push({
        id,
        d: `M ${from[0]} ${from[1]} C ${from[0] + bend * dir} ${from[1]}, ${to[0] - bend * dir} ${to[1]}, ${to[0]} ${to[1]}`,
      });
    }
    setLinks((prev) => (prev.length === next.length && prev.every((l, i) => l.d === next[i].d) ? prev : next));
  }, [pairs]);

  if (links.length === 0) return null;
  return (
    <svg className="research-links" aria-hidden="true">
      <defs>
        <marker id="research-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="research-links-marker" />
        </marker>
      </defs>
      {links.map((l) => (
        <path key={l.id} d={l.d} className="research-links-path" markerEnd="url(#research-arrow)" />
      ))}
    </svg>
  );
}

interface HoverPreviewState {
  node: ResearchNode;
  rect: SelectionTarget["rect"];
}

/**
 * Returns the explained term under the cursor, if any. Uses the caret
 * position to find the text node + offset, then checks whether the offset
 * falls inside an occurrence of an already-explained term — full-string
 * matching, so CJK terms work without tokenization.
 */
function matchExplainedTermAt(
  x: number,
  y: number,
  nodes: ResearchNode[],
  openIds: string[],
): HoverPreviewState | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let textNode: Text | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    textNode = range.startContainer as Text;
    offset = range.startOffset;
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    textNode = pos.offsetNode as Text;
    offset = pos.offset;
  }
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const text = textNode.data ?? "";
  const ownerCard = textNode.parentElement?.closest("[data-research-node-id]");
  const hay = text.toLowerCase();

  for (const node of nodes) {
    if (node.status !== "done") continue;
    if (openIds.includes(node.id)) continue; // the real card is already visible
    if (ownerCard?.getAttribute("data-research-node-id") === node.id) continue;
    const needle = node.term.trim().toLowerCase();
    if (!needle) continue;
    let at = hay.indexOf(needle);
    while (at !== -1) {
      if (offset >= at && offset <= at + needle.length) {
        const r = document.createRange();
        r.setStart(textNode, at);
        r.setEnd(textNode, at + needle.length);
        const rect = r.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) break;
        return {
          node,
          rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width },
        };
      }
      at = hay.indexOf(needle, at + 1);
    }
  }
  return null;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
  clear(): void;
}

/**
 * Underline every occurrence of an explained term in the rendered markdown
 * so readers can tell at a glance which words have research behind them.
 * Uses the CSS Custom Highlight API: ranges are registered outside the DOM,
 * so React never sees mutated nodes. Silently does nothing where
 * unsupported. Hovering a highlighted term then summons the preview.
 */
function useExplainedTermHighlights(nodes: ResearchNode[], skipNodeIds: Set<string>) {
  useEffect(() => {
    const w = window as typeof window & {
      Highlight?: new (...ranges: Range[]) => unknown;
      CSS?: { highlights?: HighlightRegistry };
    };
    if (typeof w.Highlight !== "function" || !w.CSS?.highlights) return;

    // Lightning CSS rejects ::highlight() at build time, so the rule is
    // registered through CSSOM here where only the browser parses it.
    if (!document.getElementById("research-termed-style")) {
      const style = document.createElement("style");
      style.id = "research-termed-style";
      style.textContent = [
        "::highlight(research-termed) {",
        "  background-color: color-mix(in srgb, var(--accent) 13%, transparent);",
        "  text-decoration: underline;",
        "  text-decoration-style: dotted;",
        "  text-decoration-color: color-mix(in srgb, var(--accent) 60%, transparent);",
        "  text-underline-offset: 3px;",
        "}",
      ].join("\n");
      document.head.appendChild(style);
    }

    // Skip expensive re-scans while an explanation is streaming; only the
    // set of terms (and where cards are open) matters for the ranges.
    const done = nodes.filter((n) => n.status === "done" && !skipNodeIds.has(n.id));
    if (done.length === 0) {
      w.CSS.highlights.delete("research-termed");
      return;
    }

    const ranges: Range[] = [];
    for (const container of document.querySelectorAll(".markdown-body")) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const text = (textNode as Text).data;
        if (text.trim().length > 0) {
          const hay = text.toLowerCase();
          for (const node of done) {
            const needle = node.term.trim().toLowerCase();
            if (needle.length === 0) continue;
            let at = hay.indexOf(needle);
            while (at !== -1) {
              const r = document.createRange();
              r.setStart(textNode, at);
              r.setEnd(textNode, at + needle.length);
              ranges.push(r);
              at = hay.indexOf(needle, at + 1);
            }
          }
        }
        textNode = walker.nextNode();
      }
    }
    if (ranges.length === 0) {
      w.CSS.highlights.delete("research-termed");
      return;
    }
    w.CSS.highlights.set("research-termed", new w.Highlight(...ranges));
  }, [nodes, skipNodeIds]);
}

interface Props {
  provider?: string;
  modelId?: string;
  cwd?: string;
  /** Display names for models, keyed `provider:model` or bare model id. */
  modelNames?: Record<string, string>;
  /** Session identity that owns the chain (session id or new-session draft key). */
  scopeKey?: string;
}

/**
 * Research Lens overlay: watches text selections inside any rendered
 * markdown (chat messages, explanations), offers an inline "explain" action,
 * hosts the recursive explanation cards and the concept-chain panel.
 */
export function TermResearchOverlay({ provider, modelId, cwd, modelNames, scopeKey }: Props) {
  const { t, locale } = useI18n();
  const research = useTermResearch(locale, scopeKey);
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [positions, setPositions] = useState<Record<string, TermCardPosition>>({});
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<HoverPreviewState | null>(null);
  const targetRef = useRef<SelectionTarget | null>(null);
  targetRef.current = target;
  const previewRef = useRef<HoverPreviewState | null>(null);
  previewRef.current = preview;
  const previewTimersRef = useRef<{ show?: number; hide?: number }>({});

  const clearPreviewTimers = useCallback(() => {
    if (previewTimersRef.current.show !== undefined) {
      window.clearTimeout(previewTimersRef.current.show);
      previewTimersRef.current.show = undefined;
    }
    if (previewTimersRef.current.hide !== undefined) {
      window.clearTimeout(previewTimersRef.current.hide);
      previewTimersRef.current.hide = undefined;
    }
  }, []);

  const schedulePreviewHide = useCallback(() => {
    clearPreviewTimers();
    // Small delay lets the pointer travel the gap between term and preview.
    previewTimersRef.current.hide = window.setTimeout(() => setPreview(null), 180);
  }, [clearPreviewTimers]);

  const handleCardPositionChange = useCallback((id: string, pos: TermCardPosition) => {
    // {-1,-1} is the double-click reset signal: fall back to auto placement.
    if (pos.x < 0 && pos.y < 0) {
      setPositions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setPositions((prev) => ({ ...prev, [id]: pos }));
  }, []);

  // Opening from the concept chain (or the hover preview) also flashes the
  // card so the reader can find it among several open explanations. A card
  // keeps its last position across close/reopen: the centered spot is
  // computed once and persisted, so repeated opens never jump around.
  const openFromChain = useCallback((id: string) => {
    research.openCard(id);
    setPositions((prev) => {
      if (prev[id]) return prev;
      const index = research.openIds.length;
      const next = {
        ...prev,
        [id]: computeCardPosition(null, index, window.innerWidth, window.innerHeight),
      };
      return next;
    });
    setFlashingId(id);
    window.setTimeout(() => {
      setFlashingId((current) => (current === id ? null : current));
    }, 1200);
  }, [research]);

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setTarget(null);
        return;
      }
      const anchorEl = getSelectionAnchorElement(selection);
      if (!anchorEl || !anchorEl.closest(".markdown-body")) {
        setTarget(null);
        return;
      }
      const raw = selection.toString();
      const term = raw.trim().slice(0, MAX_TERM_LENGTH);
      if (!term) {
        setTarget(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setTarget({
        term,
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width },
      });
    };
    const onScroll = (event: Event) => {
      // Scrolling inside the preview must not dismiss it — the reader is
      // exactly where they are supposed to be.
      if (event.target instanceof Element && event.target.closest(".research-hover-preview")) return;
      if (targetRef.current) setTarget(null);
      clearPreviewTimers();
      setPreview(null);
    };
    const onHoverOver = (event: MouseEvent) => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el.closest(".research-hover-preview")) {
        clearPreviewTimers(); // reading inside the preview — keep it up
        return;
      }
      if (!el.closest(".markdown-body")) {
        if (previewRef.current) schedulePreviewHide();
        return;
      }
      const hit = matchExplainedTermAt(event.clientX, event.clientY, research.nodes, research.openIds);
      if (!hit) {
        if (previewRef.current) schedulePreviewHide();
        return;
      }
      if (previewRef.current?.node.id === hit.node.id) {
        clearPreviewTimers();
        return;
      }
      clearPreviewTimers();
      previewTimersRef.current.show = window.setTimeout(() => setPreview(hit), 260);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewRef.current) {
        clearPreviewTimers();
        setPreview(null);
        return;
      }
      if (targetRef.current) {
        setTarget(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (research.openCount > 0) {
        event.stopPropagation();
        research.closeTopCard();
      }
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mouseover", onHoverOver);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mouseover", onHoverOver);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearPreviewTimers, research, schedulePreviewHide]);

  const handleExplain = useCallback(() => {
    const current = targetRef.current;
    if (!current) return;
    const selection = window.getSelection();
    const anchorEl = selection ? getSelectionAnchorElement(selection) : null;
    const container = anchorEl?.closest(".markdown-body") ?? null;
    const context = container?.textContent
      ? trimContextAround(container.textContent, current.term)
      : undefined;
    const parentId = findParentNodeId(container);
    // Prefer the live selection rect: the page may have scrolled since
    // selectionchange last fired.
    const liveRect = selection && !selection.isCollapsed && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : null;
    const anchor = liveRect
      ? { top: liveRect.top, left: liveRect.left, bottom: liveRect.bottom, right: liveRect.right, width: liveRect.width }
      : current.rect;
    const id = research.explain({
      term: current.term,
      context,
      parentId,
      provider,
      modelId,
      cwd,
    });
    if (id) {
      setPositions((prev) => ({
        ...prev,
        [id]: computeCardPosition(anchor, research.openCount, window.innerWidth, window.innerHeight),
      }));
    }
    selection?.removeAllRanges();
    setTarget(null);
  }, [cwd, modelId, provider, research]);

  // The preview's height is only known after it renders, so position it in
  // a layout effect: above the term (bottom edge aligned), falling back to
  // below, and finally clamped on screen. Off-screen placement is what made
  // the "open" button unreachable for terms near the viewport bottom.
  const previewElRef = useRef<HTMLDivElement | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!preview) {
      setPreviewPos(null);
      return;
    }
    const el = previewElRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(CARD_WIDTH, vw - 16);
    const h = el.offsetHeight;
    const x = Math.min(Math.max(8, preview.rect.left + preview.rect.width / 2 - w / 2), vw - w - 8);
    const gap = 8;
    const aboveY = preview.rect.top - gap - h;
    const belowY = preview.rect.bottom + gap;
    let y: number;
    if (aboveY >= 8) y = aboveY;
    else if (belowY + h <= vh - 8) y = belowY;
    else y = Math.max(8, Math.min(belowY, vh - h - 8));
    setPreviewPos((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
  }, [preview]);

  const cards = useMemo(() => {
    return research.openIds.flatMap((id) => {
      const node = research.byId.get(id);
      if (!node) return [];
      const path: ResearchNode[] = [];
      let current: ResearchNode | undefined = node;
      let guard = 0;
      while (current && guard++ < 64) {
        path.unshift(current);
        current = current.parentId ? research.byId.get(current.parentId) : undefined;
      }
      const index = research.openIds.indexOf(id);
      const position = positions[id]
        ?? computeCardPosition(null, index, window.innerWidth, window.innerHeight);
      return [{ id, node, path, position, index }];
    });
  }, [positions, research.byId, research.openIds]);

  // Arrow pairs: only when both parent and child cards are open.
  const linkPairs = useMemo(
    () => cards
      .filter(({ node }) => node.parentId && cards.some((c) => c.id === node.parentId))
      .map(({ id, node }) => ({ id, parentId: node.parentId! })),
    [cards],
  );

  // Highlight explained terms everywhere except inside their own open card
  // (a re-opened chain hides while its card shows, so no double marking).
  const skipHighlightIds = useMemo(() => {
    const set = new Set<string>();
    for (const { node } of cards) set.add(node.id);
    return set;
  }, [cards]);
  useExplainedTermHighlights(research.nodes, skipHighlightIds);

  const triggerStyle = useMemo((): React.CSSProperties | null => {
    if (!target) return null;
    const centerX = target.rect.left + target.rect.width / 2;
    const x = clampTriggerX(centerX, window.innerWidth);
    const below = target.rect.bottom + TRIGGER_OFFSET;
    const y = below + TRIGGER_SIZE < window.innerHeight ? below : target.rect.top - TRIGGER_SIZE - TRIGGER_OFFSET;
    return { left: x, top: Math.max(4, y) };
  }, [target]);

  return (
    <>
      {target && triggerStyle && (
        <button
          type="button"
          className="research-trigger"
          style={triggerStyle}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleExplain}
          title={t("research.explainAction")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
          </svg>
          {t("research.explainAction")}
        </button>
      )}

      {preview && (() => {
        return (
          <div
            ref={previewElRef}
            className="research-hover-preview"
            data-research-node-id={preview.node.id}
            style={{ left: previewPos?.x ?? -9999, top: previewPos?.y ?? -9999, width: Math.min(CARD_WIDTH, window.innerWidth - 16) }}
          >
            <div className="research-hover-preview-term">{preview.node.term}</div>
            <div className="research-hover-preview-body">
              <MarkdownBody className="markdown-research-card">{preview.node.explanation}</MarkdownBody>
            </div>
            <button
              type="button"
              className="research-hover-preview-open"
              onClick={() => {
                openFromChain(preview.node.id);
                clearPreviewTimers();
                setPreview(null);
              }}
            >
              {t("research.hoverOpen")}
            </button>
          </div>
        );
      })()}

      <ResearchLinks pairs={linkPairs} />

      {cards.map(({ id, node, path, position, index }) => {
        const modelKey = node.provider && node.modelId ? `${node.provider}:${node.modelId}` : node.modelId;
        const modelLabel = node.modelId
          ? (modelKey ? modelNames?.[modelKey] : undefined) ?? modelNames?.[node.modelId] ?? node.modelId
          : undefined;
        return (
          <TermCard
            key={id}
            node={node}
            path={path}
            position={position}
            zIndex={60 + index}
            flashing={flashingId === id}
            modelLabel={modelLabel}
            onClose={() => research.closeCard(id)}
            onDepthChange={(depth) => research.setDepth(id, depth)}
            onRetry={() => research.retry(id)}
            onPositionChange={(pos) => handleCardPositionChange(id, pos)}
            onAskFollowup={(question) => research.askFollowup(id, question)}
            onWebToggle={(web) => research.setWeb(id, web)}
          />
        );
      })}

      <ConceptChain research={research} onOpen={openFromChain} />
    </>
  );
}
