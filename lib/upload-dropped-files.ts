/**
 * Uploads files that the browser could not expose a real path for (no
 * file:// URI on the drag's text/uri-list) so the agent can still read them.
 * Returns the absolute paths written by the server, aligned with `files`.
 */

export interface UploadDroppedFilesResult {
  paths: string[];
}

export async function uploadDroppedFiles(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch("/api/drop-files", { method: "POST", body: form });
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore parse errors, keep the status-based message
    }
    throw new Error(message);
  }
  const data = (await res.json()) as UploadDroppedFilesResult;
  return data.paths;
}
