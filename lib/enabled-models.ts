const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.substring(colonIndex + 1);
  return THINKING_SUFFIXES.has(suffix) ? trimmed.substring(0, colonIndex) : trimmed;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAnyModelRef(modelRef: string, exactRefs: Set<string>, wildcardRefs: RegExp[]): boolean {
  if (exactRefs.has(modelRef)) return true;
  return wildcardRefs.some((pattern) => pattern.test(modelRef));
}

export function filterByEnabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
): readonly T[] {
  if (!enabledModels || enabledModels.length === 0) return available;

  const refs = enabledModels.map(stripThinkingSuffix).filter(Boolean);
  const exactRefs = new Set(refs.filter((ref) => !ref.includes("*")));
  const wildcardRefs = refs.filter((ref) => ref.includes("*")).map(wildcardToRegExp);
  const visible = available.filter((m) => (
    matchesAnyModelRef(`${m.provider}/${m.id}`, exactRefs, wildcardRefs)
    || matchesAnyModelRef(m.id, exactRefs, wildcardRefs)
  ));
  return visible.length > 0 ? visible : available;
}
