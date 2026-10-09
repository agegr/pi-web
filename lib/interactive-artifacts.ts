import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, RootContent } from "mdast";
import { normalizeDisplayMath } from "./markdown";
import { isCompleteInteractiveFence } from "./interactive-preview";

export interface InteractiveFence {
  id?: string;
  ordinal: number;
  offset: number;
  code: string;
  complete: boolean;
}

export interface ArtifactVersion {
  id: string;
  key: string;
  entryId: string;
  blockIndex: number;
  ordinal: number;
  code?: string;
}

const parser = unified().use(remarkParse).use(remarkFrontmatter);

export function interactiveFences(markdown: string): InteractiveFence[] {
  if (!markdown.toLowerCase().includes("pi-html")) return [];
  const source = normalizeDisplayMath(markdown);
  const tree = parser.parse(source);
  const pending: Array<Root | RootContent> = [tree];
  const fences: InteractiveFence[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "code" && node.lang?.toLowerCase() === "pi-html" && node.position?.start.offset !== undefined) {
      const match = /^id=(?:"([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})"|([a-zA-Z0-9][a-zA-Z0-9_-]{0,63}))$/.exec(node.meta?.trim() ?? "");
      fences.push({
        id: match?.[1] ?? match?.[2], ordinal: fences.length, offset: node.position.start.offset,
        code: node.value, complete: isCompleteInteractiveFence(source, node.position, node.value),
      });
    }
    if ("children" in node) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
  }
  return fences;
}

export function messageArtifactVersions(entryId: string, content: unknown): ArtifactVersion[] {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block, blockIndex) => {
    if (block?.type !== "text" || typeof block.text !== "string") return [];
    return interactiveFences(block.text).flatMap((fence) => fence.id && fence.complete ? [{
      id: fence.id, key: `${entryId}:${blockIndex}:${fence.ordinal}`,
      entryId, blockIndex, ordinal: fence.ordinal, code: fence.code,
    }] : []);
  });
}

export function branchArtifactVersions(entries: Array<{ type: string; id: string; message?: { role: string; content?: unknown } }>): ArtifactVersion[] {
  return entries.flatMap((entry) => entry.type === "message" && entry.message?.role === "assistant"
    ? messageArtifactVersions(entry.id, entry.message.content) : []);
}

export function mergeArtifactVersions(history: ArtifactVersion[], local: ArtifactVersion[]): Map<string, ArtifactVersion[]> {
  const byKey = new Map(local.map((version) => [version.key, version]));
  const versions = history.map((version) => byKey.get(version.key) ?? version);
  const known = new Set(history.map((version) => version.key));
  versions.push(...local.filter((version) => !known.has(version.key)));
  const groups = new Map<string, ArtifactVersion[]>();
  for (const version of versions) {
    const group = groups.get(version.id) ?? [];
    group.push(version);
    groups.set(version.id, group);
  }
  return groups;
}
