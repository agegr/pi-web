import type { QueueEntry, QueueEntryInput, QueueImage, QueueKind } from "./queue-store";

/**
 * Client-side helpers for queue export (Markdown / JSON) and import parsing.
 * Pure functions — no node or DOM dependencies except the explicit download()
 * helper used from UI components.
 */

export interface QueueExportMeta {
  sessionId?: string;
  source: "live" | "recovery";
  exportedAt?: string;
}

const QUEUE_EXPORT_FORMAT = "pi-web-queue";

function formatTime(ts: number): string {
  return new Date(ts).toISOString();
}

function imageCountText(count: number): string {
  if (count === 0) return "";
  return count === 1 ? "(1 image)" : `(${count} images)`;
}

/** Markdown export — human-readable, images noted but not embedded. */
export function queueToMarkdown(entries: QueueEntry[], meta: QueueExportMeta): string {
  const lines: string[] = [];
  lines.push("# Queued messages export");
  if (meta.sessionId) lines.push(`- Session: ${meta.sessionId}`);
  lines.push(`- Source: ${meta.source === "live" ? "live queue" : "pending recovery"}`);
  lines.push(`- Exported: ${meta.exportedAt ?? new Date().toISOString()}`);
  lines.push("");
  if (entries.length === 0) {
    lines.push("_No entries._");
    return lines.join("\n");
  }
  entries.forEach((entry, index) => {
    lines.push(`## ${index + 1}. ${entry.kind === "steer" ? "steer" : "follow-up"} · ${formatTime(entry.queuedAt)}`);
    if (entry.text) lines.push(entry.text);
    if (entry.images?.length) lines.push(`> _${imageCountText(entry.images.length)}_`);
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * JSON export — full fidelity (images included), round-trips through
 * parseQueueImport().
 */
export function queueToJson(entries: QueueEntry[], meta: QueueExportMeta): string {
  return JSON.stringify(
    {
      format: QUEUE_EXPORT_FORMAT,
      version: 1,
      exportedAt: meta.exportedAt ?? new Date().toISOString(),
      source: meta.source,
      sessionId: meta.sessionId,
      entries: entries.map(({ kind, text, images }) => ({
        kind,
        text,
        ...(images?.length ? { images } : {}),
      })),
    },
    null,
    2,
  );
}

/** Trigger a browser download of the generated content. */
export function downloadQueueExport(
  entries: QueueEntry[],
  meta: QueueExportMeta,
  format: "md" | "json",
): void {
  const content = format === "md" ? queueToMarkdown(entries, meta) : queueToJson(entries, meta);
  const mime = format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `${meta.sessionId ?? "session"}-queue-${meta.source}-${stamp}.${format}`;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isQueueImage(value: unknown): value is QueueImage {
  return (
    Boolean(value) &&
    typeof (value as QueueImage).type === "string" &&
    typeof (value as QueueImage).data === "string" &&
    typeof (value as QueueImage).mimeType === "string"
  );
}

function normalizeEntry(value: unknown): QueueEntryInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind as QueueKind;
  if (kind !== "steer" && kind !== "followUp") return null;
  if (typeof raw.text !== "string") return null;
  let images: QueueImage[] | undefined;
  if (Array.isArray(raw.images)) {
    images = raw.images.filter(isQueueImage);
    if (images.length === 0) images = undefined;
  }
  return { kind, text: raw.text, ...(images ? { images } : {}) };
}

/**
 * Parse an imported JSON file. Accepts our export format
 * ({ format: "pi-web-queue", entries: [...] }) or a bare array. Invalid
 * entries are skipped; malformed files yield an empty array.
 */
export function parseQueueImport(content: string): QueueEntryInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const rawEntries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;
  if (!rawEntries) return [];
  return rawEntries.map(normalizeEntry).filter((e): e is QueueEntryInput => e !== null);
}
