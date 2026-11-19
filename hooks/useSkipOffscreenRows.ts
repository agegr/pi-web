"use client";

import { useCallback, type RefObject } from "react";

/** How far past the scroll container's edges a row stays laid out, as a share of its height. */
const NEAR_MARGIN = "100% 0px";
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

/**
 * Lets the browser skip the layout of transcript rows far outside the scroll
 * container (`content-visibility: auto`), so work that scales with the laid-out
 * document stays the size of the screen however many turns are loaded: Chrome's
 * selection sync on every mouse press took 42 ms with 300 turns loaded, 1.5 ms
 * with the rows off screen skipped.
 *
 * A row is skipped only once it has been laid out, at the size it was laid out
 * at, so the scroll height and every row's offset stay exact. Near the screen a
 * row is plain again: no containment clips its focus rings or shadows there.
 * The returned callback ref goes on the element whose children are the rows.
 */
export function useSkipOffscreenRows(rowsRef?: RefObject<HTMLElement | null>) {
  return useCallback((rows: HTMLElement | null) => {
    if (rowsRef) rowsRef.current = rows;
    if (!rows) return;
    const scroller = scrollParent(rows);
    if (!scroller || typeof IntersectionObserver === "undefined" || !CSS.supports?.("content-visibility", "auto")) {
      return () => { if (rowsRef) rowsRef.current = null; };
    }

    const near = new Set<Element>();
    const skipped = new Set<HTMLElement>();
    const unskip = (row: HTMLElement) => {
      row.style.removeProperty("content-visibility");
      row.style.removeProperty("contain-intrinsic-block-size");
      row.style.removeProperty("contain");
      skipped.delete(row);
    };
    const skip = (targets: HTMLElement[]) => {
      // Layout containment keeps a child's margin inside the row, as skipping
      // does, so the size read is the size the row keeps while skipped. Rows
      // sit where they did either way: the margin was between them before.
      for (const row of targets) row.style.contain = "layout";
      const sizes = targets.map(contentBlockSize);
      targets.forEach((row, index) => {
        row.style.containIntrinsicBlockSize = `auto ${sizes[index]}px`;
        row.style.contentVisibility = "auto";
        skipped.add(row);
      });
    };

    const intersection = new IntersectionObserver((entries) => {
      const far: HTMLElement[] = [];
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          near.add(row);
          if (skipped.has(row)) unskip(row);
        } else {
          near.delete(row);
          if (!skipped.has(row) && row.parentElement === rows) far.push(row);
        }
      }
      if (far.length > 0) skip(far);
    }, { root: scroller, rootMargin: NEAR_MARGIN });

    const observe = (node: Node) => {
      if (node instanceof HTMLElement) intersection.observe(node);
    };
    const forget = (node: Node) => {
      if (!(node instanceof HTMLElement) || node.parentElement === rows) return;
      intersection.unobserve(node);
      near.delete(node);
      if (skipped.has(node)) unskip(node);
    };
    Array.from(rows.children).forEach(observe);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.removedNodes.forEach(forget);
        record.addedNodes.forEach(observe);
      }
    });
    mutations.observe(rows, { childList: true });

    // A skipped row keeps its height from the old width, where its text wrapped
    // differently: once the width settles, measure them all again.
    let width = rows.getBoundingClientRect().width;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const resize = new ResizeObserver(() => {
      const next = rows.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        const stale = Array.from(skipped);
        if (stale.length === 0) return;
        stale.forEach(unskip);
        skip(stale.filter((row) => row.parentElement === rows && !near.has(row)));
      }, RESIZE_SETTLE_MS);
    });
    resize.observe(rows);

    return () => {
      if (rowsRef) rowsRef.current = null;
      if (settle) clearTimeout(settle);
      intersection.disconnect();
      mutations.disconnect();
      resize.disconnect();
      skipped.forEach(unskip);
    };
  }, [rowsRef]);
}
