"use client";

import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import type { FooterPanelData } from "@/lib/footer-status";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({
  widgets = [],
  footer = null,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** Optional structured footer panel data (see lib/footer-status.ts). */
  footer?: FooterPanelData | null;
}) {
  // statuses feed the footer panel (file counts, cache, etc.) via ChatWindow;
  // they are intentionally NOT rendered as a permanent condensed footer line.
  if (widgets.length === 0 && !footer) return null;

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${footer ? " has-footer" : ""}`}
    >
      {(widgets.length > 0 || footer) && <ExtensionWidgets widgets={widgets} footer={footer} />}
    </div>
  );
}
