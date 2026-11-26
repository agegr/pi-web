"use client";

import { useCallback, type RefObject } from "react";
import { subscribeChatAppearance } from "@/hooks/useChatAppearance";
import { subscribeFontPreferences } from "@/hooks/useFontPreferences";

/** Inside this band past the scroll container's edges (a share of its height) a row is laid out. */
const NEAR_MARGIN = "100% 0px";
/**
 * Outside this wider band a row is skipped. In between a row stays as it is:
 * IntersectionObserver reads a laid-out row's box snapped to whole pixels and a
 * skipped one's unsnapped, so one edge for both would flip a row sitting within
 * that fraction of it every frame.
 */
const FAR_MARGIN = "125% 0px";
/** A width change re-measures the skipped rows once it has settled. */
const RESIZE_SETTLE_MS = 200;

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

function contentBlockSize(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const edges = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const;
  const size = edges.reduce((height, edge) => height - (parseFloat(style[edge]) || 0), element.getBoundingClientRect().height);
  return Math.max(0, size);
}

/** The child of `rows` that holds `node`, if any. */
function rowOf(rows: Node, node: Node | null): Node | null {
  for (let current = node; current; current = current.parentNode) {
    if (current.parentNode === rows) return current;
  }
  return null;
}

/**
 * Skips the layout of `rows`' children while they are far outside the scroll
 * container; see `useSkipOffscreenRows`. Returns the cleanup, or null when the
 * browser cannot skip rows or `rows` has no scroll container.
 */
export function skipOffscreenRows(rows: HTMLElement): (() => void) | null {
  const scroller = scrollParent(rows);
  if (!scroller || typeof IntersectionObserver === "undefined" || typeof ResizeObserver === "undefined" || !CSS.supports?.("content-visibility", "auto")) return null;

  const inside = new Set<Element>();
  const skipped = new Set<HTMLElement>();
  const stale = new Set<HTMLElement>();
  const unskip = (row: HTMLElement) => {
    row.style.removeProperty("content-visibility");
    row.style.removeProperty("contain-intrinsic-block-size");
    skipped.delete(row);
  };
  // The size alone, without `auto`: a size the browser remembered from an
  // earlier layout of the row is not what it has laid out now.
  const skip = (targets: HTMLElement[]) => {
    const sizes = targets.map(contentBlockSize);
    targets.forEach((row, index) => {
      row.style.containIntrinsicBlockSize = `${sizes[index]}px`;
      row.style.contentVisibility = "auto";
      skipped.add(row);
    });
  };

  // A skipped row that may no longer be the size it was skipped at (its content
  // changed, the width or the fonts did) is laid out again with the next frame
  // and skipped at its new size once that layout is done: never measured in
  // the middle of a script, which would lay out every such row at once.
  const settled = new ResizeObserver((entries) => {
    const ready: HTMLElement[] = [];
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      settled.unobserve(row);
      if (!stale.delete(row)) continue;
      if (row.parentElement === rows && !inside.has(row)) ready.push(row);
    }
    if (ready.length > 0) skip(ready);
  });
  const remeasure = (targets: Iterable<HTMLElement>) => {
    for (const row of targets) {
      if (!skipped.has(row)) continue;
      unskip(row);
      stale.add(row);
      settled.observe(row);
    }
  };
  const settle = (row: HTMLElement) => {
    if (stale.delete(row)) settled.unobserve(row);
  };

  // Each observer decides one way only, so the order their callbacks run in does not matter.
  const near = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      if (!entry.isIntersecting) {
        inside.delete(row);
        continue;
      }
      inside.add(row);
      settle(row);
      if (skipped.has(row)) unskip(row);
    }
  }, { root: scroller, rootMargin: NEAR_MARGIN });
  const far = new IntersectionObserver((entries) => {
    const leaving: HTMLElement[] = [];
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      if (entry.isIntersecting || skipped.has(row) || row.parentElement !== rows) continue;
      settle(row);
      leaving.push(row);
    }
    if (leaving.length > 0) skip(leaving);
  }, { root: scroller, rootMargin: FAR_MARGIN });

  const adopt = (node: Node) => {
    if (!(node instanceof HTMLElement) || node.parentElement !== rows) return;
    near.observe(node);
    far.observe(node);
  };
  const forget = (node: Node) => {
    if (!(node instanceof HTMLElement) || node.parentElement === rows) return;
    near.unobserve(node);
    far.unobserve(node);
    inside.delete(node);
    settle(node);
    if (skipped.has(node)) unskip(node);
  };
  Array.from(rows.children).forEach(adopt);
  const mutations = new MutationObserver((records) => {
    const changed = new Set<HTMLElement>();
    for (const record of records) {
      if (record.target === rows) {
        if (record.type !== "childList") continue;
        record.removedNodes.forEach(forget);
        record.addedNodes.forEach(adopt);
        continue;
      }
      // A highlighted fence, a diagram, a re-render: content a skipped row was
      // not laid out with. A row's own style is what skipping writes.
      if (record.type === "attributes" && record.attributeName === "style" && record.target.parentNode === rows) continue;
      const row = rowOf(rows, record.target);
      if (row instanceof HTMLElement && skipped.has(row)) changed.add(row);
    }
    remeasure(changed);
  });
  mutations.observe(rows, { childList: true, subtree: true, characterData: true, attributes: true });

  // A skipped row keeps its height from the old width, where its text wrapped
  // differently: once the width settles, measure them all again.
  let width = rows.getBoundingClientRect().width;
  let widthTimer: ReturnType<typeof setTimeout> | null = null;
  const resize = new ResizeObserver(() => {
    const next = rows.getBoundingClientRect().width;
    if (next === width) return;
    width = next;
    if (widthTimer) clearTimeout(widthTimer);
    widthTimer = setTimeout(() => {
      widthTimer = null;
      remeasure(Array.from(skipped));
    }, RESIZE_SETTLE_MS);
  });
  resize.observe(rows);

  // The same once the chat's font size or fonts change, and once a font
  // finishes loading after rows that use it were skipped.
  const remeasureAll = () => remeasure(Array.from(skipped));
  const unsubscribeAppearance = subscribeChatAppearance(remeasureAll);
  const unsubscribeFonts = subscribeFontPreferences(remeasureAll);
  document.fonts?.addEventListener("loadingdone", remeasureAll);

  return () => {
    if (widthTimer) clearTimeout(widthTimer);
    near.disconnect();
    far.disconnect();
    settled.disconnect();
    mutations.disconnect();
    resize.disconnect();
    unsubscribeAppearance();
    unsubscribeFonts();
    document.fonts?.removeEventListener("loadingdone", remeasureAll);
    skipped.forEach(unskip);
  };
}

/**
 * Lets the browser skip the layout of transcript rows far outside the scroll
 * container (`content-visibility: auto`), so work that scales with the laid-out
 * document stays the size of the screen however many turns are loaded: Chrome's
 * selection sync on every mouse press took 42 ms with 300 turns loaded, 1.5 ms
 * with the rows off screen skipped.
 *
 * A skipped row keeps the size it has laid out, so the scroll height and every
 * row's offset stay exact. That needs each block row to be its own block
 * formatting context, as skipping makes it, so its children's margins stay
 * inside it either way: the element this ref goes on carries the
 * `transcript-rows` class, whose rule in `app/globals.css` makes its children
 * `display: flow-root`. A skipped row whose content changes is measured again.
 * Near the screen a row has no containment: nothing clips its focus rings or
 * shadows there. The returned callback ref goes on the element whose children
 * are the rows.
 */
export function useSkipOffscreenRows(rowsRef?: RefObject<HTMLElement | null>) {
  return useCallback((rows: HTMLElement | null) => {
    if (rowsRef) rowsRef.current = rows;
    if (!rows) return;
    const cleanup = skipOffscreenRows(rows);
    return () => {
      if (rowsRef) rowsRef.current = null;
      cleanup?.();
    };
  }, [rowsRef]);
}
