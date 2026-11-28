import { encodeFilePathForApi } from "./file-paths";

/** Browser side of the explorer's `mkdir`, `move` and `delete` (`lib/file-manage.ts`). */
async function post(target: string, type: string, body: object): Promise<{ path?: string }> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(target)}?type=${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

/** @returns The new folder's path */
export async function createFolder(parent: string, name: string): Promise<string> {
  return (await post(parent, "mkdir", { name })).path ?? "";
}

/** Moves `source` into `destination` as `name`; returns where it landed. */
export async function moveFileEntry(source: string, destination: string, name: string): Promise<string> {
  return (await post(source, "move", { destination, name })).path ?? "";
}

export async function deleteFileEntry(source: string): Promise<void> {
  await post(source, "delete", {});
}

/**
 * What an explorer row carries while dragged, under its own type so a drop
 * tells it from a file or text from another app: its path, and the @ mention
 * the composer inserts when it lands there.
 */
export const FILE_ENTRY_DRAG_MIME = "application/x-pi-web-file";

export function fileEntryDragData(path: string, mention: string): string {
  return JSON.stringify({ path, mention });
}

interface DragSource {
  types: readonly string[];
  getData(format: string): string;
}

/** The dragged row's @ mention, or null when this drag is not an explorer row. */
export function readFileEntryMention(dataTransfer: DragSource): string | null {
  if (!dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) return null;
  try {
    const parsed = JSON.parse(dataTransfer.getData(FILE_ENTRY_DRAG_MIME)) as { mention?: unknown };
    return typeof parsed.mention === "string" && parsed.mention ? parsed.mention : null;
  } catch {
    return null;
  }
}
