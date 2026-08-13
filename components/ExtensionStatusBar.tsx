"use client";

import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function ExtensionStatusBar({
  widgets = [],
  onRunCommand,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  onRunCommand?: (command: string) => void;
}) {
  if (widgets.length === 0) return null;

  return (
    <div className="extension-status-shelf has-widgets">
      <ExtensionWidgets widgets={widgets} onRunCommand={onRunCommand} />
    </div>
  );
}
