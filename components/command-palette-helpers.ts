export interface CommandPaletteItem {
  id: string;
  label: string;
  group: string;
  detail?: string;
  keywords?: string;
  onSelect: () => void;
}

export function filterCommandItems<T extends Pick<CommandPaletteItem, "label" | "group" | "detail" | "keywords">>(
  items: readonly T[],
  query: string,
): T[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [...items];

  return items.filter((item) => {
    const haystack = `${item.label} ${item.group} ${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function getNextSelectedIndex(currentIndex: number, total: number, direction: "up" | "down"): number {
  if (total <= 0) return 0;
  if (direction === "down") {
    return (currentIndex + 1 + total) % total;
  }
  return (currentIndex - 1 + total) % total;
}

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function isCommandPaletteShortcut(event: ShortcutKeyEvent): boolean {
  if (event.altKey) return false;
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}

export function shouldIgnoreGlobalShortcut(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
