/**
 * Deterministic ordering for extension footer tabs.
 *
 * Canonical fixed order (always appended after normal tabs):
 *   File Changes -> Details -> Tasks -> Exec Summary
 *
 * `normalizeExtensionTabOrder` is pure and idempotent: the same canonical
 * result is produced regardless of registration order or how often tabs are
 * recreated/updated, so streaming/widget updates can never move these tabs.
 */

/** Canonical fixed extension tab ids, in render order. */
export const EXTENSION_TAB_ORDER = [
  "filechanges",
  "details",
  "tasks",
  "exec-summary",
] as const;

/** User-visible labels for the fixed extension tabs. */
export const EXTENSION_TAB_LABELS: Record<string, string> = {
  filechanges: "File Changes",
  details: "Details",
  tasks: "Tasks",
  "exec-summary": "Exec Summary",
};

/**
 * Widget keys that map to a canonical fixed tab id.
 * e.g. the plan-todos widget is the "Tasks" tab.
 */
export const EXTENSION_TAB_ALIASES: Record<string, string> = {
  "plan-todos": "tasks",
};

const FIXED_IDS = new Set<string>(EXTENSION_TAB_ORDER);

/** Map a widget/footer id to its canonical fixed id (aliases resolved). */
export function canonicalExtensionTabId(id: string): string {
  return EXTENSION_TAB_ALIASES[id] ?? id;
}

/**
 * Return ids in deterministic render order:
 *   [normal tabs, in their original relative order] +
 *   [fixed extension tabs present, in canonical order]
 * Exec Summary is therefore always the final tab.
 */
export function normalizeExtensionTabOrder(ids: readonly string[]): string[] {
  const seenNormal = new Set<string>();
  const normals: string[] = [];
  for (const raw of ids) {
    const id = canonicalExtensionTabId(raw);
    if (FIXED_IDS.has(id)) continue;
    if (seenNormal.has(id)) continue;
    seenNormal.add(id);
    normals.push(id);
  }
  const present = EXTENSION_TAB_ORDER.filter((id) =>
    ids.some((raw) => canonicalExtensionTabId(raw) === id),
  );
  return [...normals, ...present];
}
