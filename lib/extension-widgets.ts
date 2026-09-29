import type { ExtensionWidgetItem } from "@/lib/types";

export function updateExtensionWidgets(
  widgets: ExtensionWidgetItem[],
  key: string,
  lines: string[] | undefined,
  placement: ExtensionWidgetItem["placement"] = "aboveEditor",
): ExtensionWidgetItem[] {
  if (lines === undefined) return widgets.filter((widget) => widget.key !== key);

  const updatedWidget = { key, lines, placement };
  const existingIndex = widgets.findIndex((widget) => widget.key === key);
  if (existingIndex === -1) return [...widgets, updatedWidget];

  return widgets.map((widget, index) => index === existingIndex ? updatedWidget : widget);
}
