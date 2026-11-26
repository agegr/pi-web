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
  if (!scroller || typeof IntersectionObserver === "undefined" || !CSS.supports?.("content-visibility", "auto")) return null;

  const near = new Set<Element>();
  const skipped = new Set<HTMLElement>();
  const sealed = new Set<HTMLElement>();
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
  // Laid out again and measured: rows whose content changed, or that were sized for another width.
  const remeasure = (stale: HTMLElement[]) => {
    stale.forEach(unskip);
    skip(stale.filter((row) => row.parentElement === rows && !near.has(row)));
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

  // Skipping contains a row's layout, so a child's margin that collapsed
  // through the row's edge would move inside it: the row grew by it as it was
  // skipped (16 px under each message), and at the band's edge that growth
  // alone flipped it back and forth every frame; where the margin had collapsed
  // with a neighbour's (a `!` command's 6 px), every row below moved too. A
  // flow-root row holds its children's margins in both states, so skipping
  // changes neither its box nor anyone's offset. Flex and grid rows already do.
  const adopt = (nodes: Node[]) => {
    const added = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement && node.parentElement === rows);
    const blocks = added.filter((row) => getComputedStyle(row).display === "block");
    for (const row of blocks) {
      row.style.display = "flow-root";
      sealed.add(row);
    }
    added.forEach((row) => intersection.observe(row));
  };
  const forget = (node: Node) => {
    if (!(node instanceof HTMLElement) || node.parentElement === rows) return;
    intersection.unobserve(node);
    near.delete(node);
    sealed.delete(node);
    if (skipped.has(node)) unskip(node);
  };
  adopt(Array.from(rows.children));
  const mutations = new MutationObserver((records) => {
    const added: Node[] = [];
    const changed = new Set<HTMLElement>();
    for (const record of records) {
      if (record.target === rows) {
        if (record.type !== "childList") continue;
        record.removedNodes.forEach(forget);
        added.push(...Array.from(record.addedNodes));
        continue;
      }
      // A highlighted fence, a diagram, a re-render: content a skipped row was
      // not laid out with. A row's own style is what skipping writes.
      if (record.type === "attributes" && record.attributeName === "style" && record.target.parentNode === rows) continue;
      const row = rowOf(rows, record.target);
      if (row instanceof HTMLElement && skipped.has(row)) changed.add(row);
    }
    adopt(added);
    if (changed.size > 0) remeasure(Array.from(changed));
  });
  mutations.observe(rows, { childList: true, subtree: true, characterData: true, attributes: true });

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
      if (skipped.size > 0) remeasure(Array.from(skipped));
    }, RESIZE_SETTLE_MS);
  });
  resize.observe(rows);

  return () => {
    if (settle) clearTimeout(settle);
    intersection.disconnect();
    mutations.disconnect();
    resize.disconnect();
    skipped.forEach(unskip);
    sealed.forEach((row) => row.style.removeProperty("display"));
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
 * row's offset stay exact, and skipping never moves a row into or out of the
 * band that decides it: block rows are `display: flow-root`, so their
 * children's margins stay inside them whether skipped or not, and a skipped row
 * whose content changes is measured again. Near the screen a row has no
 * containment: nothing clips its focus rings or shadows there. The returned
 * callback ref goes on the element whose children are the rows.
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
