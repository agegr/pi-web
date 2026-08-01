// Mapping for files dragged into the chat input from the OS file manager.
//
// Browsers never expose the real filesystem path of a dropped file on the
// File object. However, when the drag originates from the OS file manager,
// Chrome/Edge/Firefox/Safari put file:// URIs on the dataTransfer's
// "text/uri-list". pi-web is a local app (browser and agent on the same
// machine), so that path is directly usable by the agent.

/** Decode a single file:// URI into a filesystem path, or null when malformed. */
export function decodeDroppedFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let path: string;
  try {
    path = decodeURIComponent(uri.slice("file://".length));
  } catch {
    return null;
  }
  if (!path) return null;
  // file:///C:/Users/me/a.txt -> /C:/Users/me/a.txt -> C:/Users/me/a.txt
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  return path;
}

/**
 * Best-effort mapping of dropped File objects to their real filesystem paths.
 *
 * The i-th file:// URI on text/uri-list corresponds to the i-th dropped file
 * (all major browsers preserve the order). When the count does not line up —
 * or the drop did not come from the OS file manager — fall back to text/plain
 * for a single absolute-looking value, and null (the caller inserts the bare
 * file name) otherwise.
 */
export function droppedFilePaths(files: File[], uriList: string, plainText: string): (string | null)[] {
  const paths: (string | null)[] = files.map(() => null);

  const uris = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const fileUris = uris.filter((uri) => uri.startsWith("file://"));
  if (fileUris.length === files.length) {
    for (let index = 0; index < files.length; index += 1) {
      paths[index] = decodeDroppedFileUri(fileUris[index]);
    }
    return paths;
  }

  // Single-file fallback: some sources put the real path on text/plain.
  // Bare basenames are useless here, so only trust absolute-looking values.
  if (files.length === 1 && plainText.trim()) {
    const candidate = plainText.trim();
    if (candidate.startsWith("/") || candidate.startsWith("~") || /^[A-Za-z]:[\\/]/.test(candidate)) {
      paths[0] = candidate;
    }
  }

  return paths;
}

/** The text inserted for a dropped file: its path when known, else its name. */
export function droppedFileReference(file: File, path: string | null): string {
  return path ?? file.name;
}
