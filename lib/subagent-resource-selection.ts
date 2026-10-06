/** Profile YAML aliases, not a second resource configuration format. Safe to use in the editor. */
export type SubagentResourceSelection = boolean | string[];

export function parseResourceSelection(value: unknown, fallback: SubagentResourceSelection = false): SubagentResourceSelection {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "all"].includes(text)) return true;
    if (["false", "none"].includes(text)) return false;
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  return fallback;
}

/** A legacy false is a kill switch; a legacy true must not erase a whitelist. */
export function profileResourceSelection(alias: unknown, legacy: unknown, fallback = false): SubagentResourceSelection {
  if (legacy === false) return false;
  return parseResourceSelection(alias, typeof legacy === "boolean" ? legacy : fallback);
}

export function resourceSelectionEnabled(selection: SubagentResourceSelection): boolean {
  return selection !== false;
}

export function sameResourceSelection(a: SubagentResourceSelection, b: SubagentResourceSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Raw candidates, including ambiguous aliases. Paths are slash-normalized but case-sensitive. */
export function resourceMatchCandidates<T extends { path: string; identity: string; names: string[]; pathAliases?: string[] }>(value: string, items: T[]): T[] {
  const normalized = value.replaceAll("\\", "/");
  return items.filter((item) => (item.pathAliases ?? [item.path, item.identity]).some((path) => path.replaceAll("\\", "/") === normalized) || item.names.includes(value.toLowerCase()));
}

/** Client catalog matching uses server-provided aliases; one canonical identity is unambiguous. */
export function matchingResourceEntries<T extends { path: string; identity: string; names: string[]; pathAliases?: string[] }>(value: string, items: T[]): T[] {
  const matches = resourceMatchCandidates(value, items);
  return new Set(matches.map((item) => item.identity)).size === 1 ? matches : [];
}

export function resourceSelectionMode(selection: SubagentResourceSelection): "all" | "none" | "selected" {
  return selection === true ? "all" : selection === false ? "none" : "selected";
}
