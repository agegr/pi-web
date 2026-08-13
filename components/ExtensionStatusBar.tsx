"use client";

import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function ExtensionStatusBar({
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
  if (widgets.length === 0) return null;

  return (
    <div className="extension-status-shelf has-widgets">
      <ExtensionWidgets widgets={widgets} />
    </div>
  );
}
