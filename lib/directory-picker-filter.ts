import { normalizeFilePathSlashes } from "@/lib/file-paths";

/**
 * 根据 pathInput 相对于 currentPath 的后缀推导筛选词。
 * - 输入框 === 当前目录（或仅尾斜杠）→ ""（不筛选）
 * - 输入框 === 当前目录 + "/" + 后缀 → 后缀（保留原大小写）
 * - 其他 → null（跳转语义，不筛选）
 */
export function deriveDirectoryFilter(
  currentPath: string,
  pathInput: string,
): string | null {
  const normCurrent = normalizeFilePathSlashes(currentPath.trim()).replace(/\/+$/, "");
  const normInput = normalizeFilePathSlashes(pathInput.trim());
  if (normInput === normCurrent) return "";
  const prefix = `${normCurrent}/`;
  if (normInput.startsWith(prefix)) return normInput.slice(prefix.length);
  return null;
}

/**
 * 按筛选词过滤目录条目。filter 为 null 或空串时不筛选（返回全部副本）。
 * 匹配规则：不区分大小写的子串包含。
 */
export function filterDirectoryEntries<T extends { name: string }>(
  entries: readonly T[],
  filter: string | null,
): T[] {
  if (filter === null || filter === "") return [...entries];
  const needle = filter.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
