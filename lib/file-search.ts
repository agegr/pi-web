import fs from "fs";
import path from "path";

/** Directory/file names never surfaced by the file browser or search. */
export const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

/** File extensions never surfaced by the file browser or search. */
export const IGNORED_SUFFIXES = [".pyc"];

/**
 * Recursively search `root` for files whose name or relative path contains
 * `query` (case-insensitive). Results are ranked by how directly the filename
 * matches the query — exact name, name prefix, name substring, then path
 * substring — and capped at 200. Only regular files are returned; directories
 * and ignored entries are skipped, and unreadable subtrees are tolerated.
 */
export function searchFiles(root: string, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: Array<{ path: string; score: number }> = [];
  const visit = (directory: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name) || IGNORED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const lower = relative.toLowerCase();
      const name = entry.name.toLowerCase();
      const score = name === needle ? 100 : name.startsWith(needle) ? 80 : name.includes(needle) ? 60 : lower.includes(needle) ? 40 : 0;
      if (score > 0) results.push({ path: relative, score });
    }
  };
  visit(root);
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, 200).map((result) => result.path);
}
