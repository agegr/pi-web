// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __ompAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __ompAdditionalAllowedRoots: Set<string> | undefined;
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__ompAdditionalAllowedRoots) {
    globalThis.__ompAdditionalAllowedRoots = new Set();
  }
  return globalThis.__ompAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().add(normalizedRoot);
  globalThis.__ompAllowedRootsCache?.roots.add(normalizedRoot);
}
