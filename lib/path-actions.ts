import { encodeFilePathForApi } from "./file-paths";

/**
 * Client-side path actions shared by the file viewer and inline-code path chips.
 *
 * Browsers cannot navigate to `file://` URLs, so every "show me this on disk"
 * action goes through /api/open-folder, which validates the path against the
 * same allow-list as /api/files before spawning anything.
 */

/**
 * True when /api/files can serve this path as a file.
 *
 * A directory (or a path outside the allowed roots) answers with an error, so
 * callers can fall back to opening the folder instead of showing a viewer error.
 */
export async function pathIsReadableFile(filePath: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/files/${encodeFilePathForApi(filePath)}?type=meta`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Resolves to an error message, or null when the file manager was launched. */
export async function revealPathInFileManager(filePath: string): Promise<string | null> {
  try {
    const response = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    if (response.ok) return null;
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return body?.error ?? `HTTP ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
