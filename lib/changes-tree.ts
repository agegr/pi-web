import { getRelativeFilePath, normalizeFilePathSlashes } from "./file-paths";
import type { GitFileStatus } from "./git-types";

export interface ChangesTreeNode {
  name: string;
  /** Relative path from the project cwd, e.g. "components" or "components/App.tsx". */
  path: string;
  isDir: boolean;
  /** Present on file leaves only. */
  status?: GitFileStatus;
  children: ChangesTreeNode[];
}

/**
 * Fold the flat Git changed-files list into a directory tree. Directories
 * come before files and siblings are sorted alphabetically at every level,
 * matching the explorer and the file-search tree.
 */
export function buildChangesTree(files: readonly GitFileStatus[], cwd: string): ChangesTreeNode[] {
  const roots: ChangesTreeNode[] = [];
  const byPath = new Map<string, ChangesTreeNode>();

  for (const status of files) {
    const relative = getRelativeFilePath(status.filePath, cwd);
    const normalized = normalizeFilePathSlashes(relative).replace(/^\/+/, "");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let current = roots;
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLast = i === segments.length - 1;
      let node = byPath.get(currentPath);
      if (!node) {
        node = {
          name: segment,
          path: currentPath,
          isDir: !isLast,
          children: [],
        };
        byPath.set(currentPath, node);
        current.push(node);
      } else if (!isLast) {
        node.isDir = true;
      }
      if (isLast) {
        node.isDir = false;
        node.status = status;
        node.children = [];
      }
      current = node.children;
    }
  }

  const sort = (nodes: ChangesTreeNode[]) => {
    nodes.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}

/** Every directory path in the tree, for default expand-all in tree view. */
export function listChangesDirectoryPaths(nodes: readonly ChangesTreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: readonly ChangesTreeNode[]) => {
    for (const node of list) {
      if (!node.isDir) continue;
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}
