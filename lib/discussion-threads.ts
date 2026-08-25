import type { SessionTreeNode } from "./types";

export const DISCUSSION_THREAD_CUSTOM_TYPE = "pi-web.thread";

export interface DiscussionThreadMetadata {
  version: 1;
  sourceEntryId: string;
  hostLeafId: string | null;
  selectedMarkdown: string;
  /** Stable rendered Markdown block ID, when the selection was inside one. */
  anchorKey?: string;
  title: string;
  status: "open";
}

export interface DiscussionThreadDescriptor {
  id: string;
  sourceEntryId: string;
  hostLeafId: string | null;
  selectedMarkdown: string;
  title: string;
  latestLeafId: string;
  metadata: DiscussionThreadMetadata;
  node: SessionTreeNode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function threadTitleFromMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/gm, "")
    .replace(/[`*_~>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Discussion";
  return normalized.length > 48 ? `${normalized.slice(0, 48).trimEnd()}…` : normalized;
}

export function parseDiscussionThreadMetadata(value: unknown): DiscussionThreadMetadata | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== 1
    || typeof value.sourceEntryId !== "string"
    || !(typeof value.hostLeafId === "string" || value.hostLeafId === null)
    || typeof value.selectedMarkdown !== "string"
  ) return null;

  return {
    version: 1,
    sourceEntryId: value.sourceEntryId,
    hostLeafId: value.hostLeafId,
    selectedMarkdown: value.selectedMarkdown,
    ...(typeof value.anchorKey === "string" && value.anchorKey.trim()
      ? { anchorKey: value.anchorKey.trim() }
      : {}),
    title: typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : threadTitleFromMarkdown(value.selectedMarkdown),
    status: "open",
  };
}

function latestDescendantId(root: SessionTreeNode): string {
  let latest = root;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length === 0 && (
      latest === root || Date.parse(node.entry.timestamp) >= Date.parse(latest.entry.timestamp)
    )) {
      latest = node;
    }
    stack.push(...node.children);
  }
  return latest.entry.id;
}

function subtreeContainsEntry(root: SessionTreeNode, entryId: string | null): boolean {
  if (!entryId) return false;
  // `compressedEntryIds` lists entries contracted *above* a node, so the root's
  // own list is made of ancestors and must not count as thread membership.
  // Without this, a linear session contracts the whole main conversation into
  // the thread node and every main leaf looks like it is inside the thread.
  if (root.entry.id === entryId) return true;
  const stack = [...root.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.id === entryId || node.compressedEntryIds?.includes(entryId)) return true;
    stack.push(...node.children);
  }
  return false;
}

export function collectDiscussionThreads(tree: SessionTreeNode[]): DiscussionThreadDescriptor[] {
  const threads: DiscussionThreadDescriptor[] = [];
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.type === "custom" && node.entry.customType === DISCUSSION_THREAD_CUSTOM_TYPE) {
      const metadata = parseDiscussionThreadMetadata(node.entry.data);
      if (metadata) {
        threads.push({
          id: node.entry.id,
          sourceEntryId: metadata.sourceEntryId,
          hostLeafId: metadata.hostLeafId,
          selectedMarkdown: metadata.selectedMarkdown,
          title: metadata.title,
          latestLeafId: latestDescendantId(node),
          metadata,
          node,
        });
      }
    }
    stack.push(...node.children);
  }
  return threads.sort((a, b) => Date.parse(a.node.entry.timestamp) - Date.parse(b.node.entry.timestamp));
}

export function findActiveDiscussionThread(
  threads: DiscussionThreadDescriptor[],
  activeLeafId: string | null,
): DiscussionThreadDescriptor | null {
  return threads.find((thread) => subtreeContainsEntry(thread.node, activeLeafId)) ?? null;
}

/**
 * An unopened session has no runtime navigation state: pi restores its newest
 * leaf, which can be a side discussion. Open those sessions on their main
 * conversation instead. A live session deliberately keeps its selected leaf
 * so an explicitly opened thread remains open.
 */
export function resolveInactiveSessionLeafId(
  tree: SessionTreeNode[],
  leafId: string | null,
): string | null {
  const activeThread = findActiveDiscussionThread(collectDiscussionThreads(tree), leafId);
  return activeThread ? resolveThreadMainLeafId(tree, activeThread) : leafId;
}

function findNode(tree: SessionTreeNode[], entryId: string): SessionTreeNode | null {
  const stack = [...tree];
  let contracted: SessionTreeNode | null = null;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.id === entryId) return node;
    // A contracted match means the entry was folded into the path above this
    // node, so it is only a fallback: prefer a node that really is the entry.
    if (!contracted && node.compressedEntryIds?.includes(entryId)) contracted = node;
    stack.push(...node.children);
  }
  return contracted;
}

function isThreadNode(node: SessionTreeNode): boolean {
  return node.entry.type === "custom"
    && node.entry.customType === DISCUSSION_THREAD_CUSTOM_TYPE
    && parseDiscussionThreadMetadata(node.entry.data) !== null;
}

/**
 * Resolve where "return to main" should land.
 *
 * `hostLeafId` records the leaf at creation time, which is usually the source
 * response itself. Navigating back to it would discard everything the main
 * conversation appended afterwards, so walk the newest non-thread descendants
 * of the source instead and only fall back to the recorded metadata.
 */
export function resolveThreadMainLeafId(
  tree: SessionTreeNode[],
  thread: DiscussionThreadDescriptor,
): string | null {
  const source = findNode(tree, thread.sourceEntryId);
  // A contracted lookup can land on the thread node itself. Walking down from
  // there would stay inside the thread, so treat that as "no main branch".
  if (!source || isThreadNode(source)) return thread.hostLeafId ?? thread.sourceEntryId;

  let node: SessionTreeNode = source;
  const seen = new Set<SessionTreeNode>();
  for (;;) {
    if (seen.has(node)) break;
    seen.add(node);
    const candidates: SessionTreeNode[] = node.children.filter((child) => !isThreadNode(child));
    if (candidates.length === 0) break;
    node = candidates.reduce((newest: SessionTreeNode, child: SessionTreeNode) => (
      Date.parse(child.entry.timestamp) >= Date.parse(newest.entry.timestamp) ? child : newest
    ));
  }
  return node.entry.id;
}

export function groupDiscussionThreadsBySource(
  threads: DiscussionThreadDescriptor[],
): Map<string, DiscussionThreadDescriptor[]> {
  const grouped = new Map<string, DiscussionThreadDescriptor[]>();
  for (const thread of threads) {
    const current = grouped.get(thread.sourceEntryId) ?? [];
    current.push(thread);
    grouped.set(thread.sourceEntryId, current);
  }
  return grouped;
}
