// Keep an explicit right-panel order without losing tabs opened after the last move.
export function orderPanelTabs<T extends { id: string }>(tabs: T[], order: string[]): T[] {
  if (!order.length) return tabs;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const ordered: T[] = [];
  for (const id of order) {
    const tab = byId.get(id);
    if (tab) {
      ordered.push(tab);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}

export function movePanelTab(ids: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids;
  const result = ids.filter((id) => id !== source);
  result.splice(result.indexOf(target) + (after ? 1 : 0), 0, source);
  return result;
}
