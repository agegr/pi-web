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
  const stack = [root];
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
