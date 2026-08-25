export interface SearchTreeNode {
  name: string;
  /** Full relative path of this node, e.g. "components/App.tsx" or "components". */
  path: string;
  isDir: boolean;
  children: SearchTreeNode[];
}

/**
 * Fold flat search-result paths into a directory tree. Directories come
 * before files and siblings are sorted alphabetically at every level, so the
 * results read like the real file tree. Duplicate paths collapse into a
 * single node.
 */
export function buildSearchTree(paths: string[]): SearchTreeNode[] {
  const roots: SearchTreeNode[] = [];
  const byPath = new Map<string, SearchTreeNode>();
  for (const relative of paths) {
    const segments = relative.split("/");
    let current = roots;
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
      let node = byPath.get(currentPath);
      if (!node) {
        node = { name: segments[i], path: currentPath, isDir: i < segments.length - 1, children: [] };
        byPath.set(currentPath, node);
        current.push(node);
      }
      current = node.children;
    }
  }
  const sort = (nodes: SearchTreeNode[]) => {
    nodes.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
