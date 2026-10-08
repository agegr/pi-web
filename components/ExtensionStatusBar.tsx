"use client";

import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";

/**
 * `ctx.ui.setStatus("command:/mode toggle", "Build")` shows "Build" as a button
 * that sends `/mode toggle`. The command lives in the key because setStatus has
 * no room for it, and Pi's own footer prints only the text, so the same status
 * is still plain text there.
 */
export const EXTENSION_STATUS_COMMAND_PREFIX = "command:";

/** The slash command a status key asks for, or null for an ordinary status. */
export function extensionStatusCommand(key: string): string | null {
  if (!key.startsWith(EXTENSION_STATUS_COMMAND_PREFIX)) return null;
  const command = key.slice(EXTENSION_STATUS_COMMAND_PREFIX.length).trim();
  return command.length > 1 && command.startsWith("/") ? command : null;
}

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

function sortedStatuses(statuses: ExtensionStatusItem[]): ExtensionStatusItem[] {
  return [...statuses].sort((a, b) => a.key.localeCompare(b.key));
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return sortedStatuses(statuses)
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

type StatusCell =
  | { kind: "text"; text: string }
  | { kind: "command"; command: string; label: string };

/** One cell per status, in key order. A status with nothing visible to show has no cell. */
export function buildExtensionStatusCells(statuses: ExtensionStatusItem[]): StatusCell[] {
  const cells: StatusCell[] = [];
  for (const item of sortedStatuses(statuses)) {
    const text = sanitizeExtensionStatusText(item.text);
    const command = extensionStatusCommand(item.key);
    if (command) {
      const label = stripAnsi(text).replace(/\s+/g, " ").trim();
      cells.push({ kind: "command", command, label: label || command });
    } else if (stripAnsi(text).trim()) {
      cells.push({ kind: "text", text });
    }
  }
  return cells;
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  onCommand,
  commandsDisabled = false,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** Sends the command of a `command:` status; without it those buttons stay disabled. */
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  const cells = buildExtensionStatusCells(statuses);
  if (cells.length === 0 && widgets.length === 0) return null;

  const hasCommands = cells.some((cell) => cell.kind === "command");
  const plainStatusLine = cells
    .map((cell) => (cell.kind === "text" ? stripAnsi(cell.text) : cell.label))
    .join(" ");

  const statusLine = cells.length > 0 ? (
    <div
      role="status"
      className="extension-status-line"
      aria-label={plainStatusLine}
      title={plainStatusLine}
    >
      <span className="extension-status-text">
        {cells.map((cell, index) => cell.kind === "text" ? (
          <span key={index} className="extension-status-item">
            <AnsiText text={cell.text} />
          </span>
        ) : (
          <button
            key={index}
            type="button"
            className="extension-status-item extension-status-command"
            disabled={!onCommand || commandsDisabled}
            title={`${cell.label} · ${cell.command}`}
            aria-label={`${cell.label} (${cell.command})`}
            onClick={() => onCommand?.(cell.command)}
          >
            {cell.label}
          </button>
        ))}
      </span>
    </div>
  ) : null;

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${cells.length > 0 ? " has-status" : ""}${hasCommands ? " has-commands" : ""}`}
    >
      {widgets.length > 0 ? <ExtensionWidgets widgets={widgets}>{statusLine}</ExtensionWidgets> : statusLine}
    </div>
  );
}
