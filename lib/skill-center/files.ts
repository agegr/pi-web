import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isExistingPathWithinRoots } from "../path-security";
import { getSkillCenterConfig } from "./config";
import { fileRevision } from "./inventory";

export interface TreeFile { path: string; kind: "file" | "directory"; size: number | null; previewable: boolean; sha?: string; revision?: string }
export { safeRelative } from "./relative-path";
export function localTree(root: string): { files: TreeFile[]; complete: boolean; reason: string | null } {
  const config = getSkillCenterConfig();
  const files: TreeFile[] = [];
  const visited = new Set<string>();
  let complete = true;
  function visit(dir: string) {
    const real = realpathSync(dir);
    if (visited.has(real) || !isExistingPathWithinRoots(dir, new Set([root]))) { complete = false; return; }
    visited.add(real);
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (files.length >= config.maxTreeEntries) { complete = false; return; }
      const target = join(dir, entry.name);
      if (!isExistingPathWithinRoots(target, new Set([root]))) { complete = false; continue; }
      const stat = statSync(target);
      const path = relative(root, target).replace(/\\/g, "/");
      if (stat.isDirectory()) { files.push({ path, kind: "directory", size: null, previewable: false }); visit(target); }
      else if (stat.isFile()) files.push({ path, kind: "file", size: stat.size, previewable: stat.size <= config.maxTextBytes, revision: fileRevision(target) });
      else complete = false;
    }
  }
  try { visit(root); } catch { complete = false; }
  return { files, complete, reason: complete ? null : "部分文件不可读取、存在越界链接或已达到文件数量限制。" };
}
export function textContent(path: string, buffer: Buffer, sourceUrl: string | null = null) {
  const tooLarge = buffer.length > getSkillCenterConfig().maxTextBytes;
  let text: string | null = null;
  try { if (!tooLarge && !buffer.includes(0)) text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { /* binary */ }
  return { path, state: tooLarge ? "too-large" as const : text === null ? "binary" as const : "text" as const, text, bytes: buffer.length, mimeType: text === null ? null : "text/plain", complete: !tooLarge && text !== null, sourceUrl };
}
