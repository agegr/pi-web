/**
 * Helpers for extracting and formatting file paths from clipboard / drag-drop data.
 * Supports Windows Explorer (CF_HDROP / File.path), macOS Finder (file-url / uri-list),
 * and Linux file managers (Nautilus, Dolphin, Thunar, etc.).
 */

/**
 * Converts a file:// URI to a local file system path.
 * Handles Windows drive letters, Unix paths, percent-encoding, and UNC network paths.
 */
export function fileUriToPath(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed.startsWith("file://")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    let pathname = decodeURIComponent(parsed.pathname);

    // On Windows, URL pathname for file:///C:/path is "/C:/path" -> "C:/path"
    if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
      pathname = pathname.slice(1);
    } else if (parsed.host && parsed.host !== "localhost") {
      // UNC path: file://server/share/file -> //server/share/file
      pathname = `//${parsed.host}${pathname}`;
    }

    return pathname;
  } catch {
    let raw = trimmed.replace(/^file:\/\/(localhost)?/, "");
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Ignore URI decode errors and use raw string
    }
    if (/^\/[a-zA-Z]:[\\/]/.test(raw)) {
      raw = raw.slice(1);
    }
    return raw;
  }
}

export interface ExtractPathsOptions {
  /**
   * If true and no full paths or URIs could be found,
   * fall back to returning the `name` property of clipboard File objects.
   */
  fallbackToFileName?: boolean;
}

const LINUX_CLIPBOARD_TYPES = [
  "text/uri-list",
  "x-special/nautilus-clipboard",
  "x-special/gnome-copied-files",
  "x-special/mate-copied-files",
  "x-special/xfce4-copied-files",
  "application/x-kde-cutselection",
  "public.file-url",
  "text/x-moz-url",
  "application/x-moz-file",
];

function extractPathsFromText(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const paths: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "copy" || trimmed === "cut") {
      continue;
    }
    if (trimmed.startsWith("file://")) {
      paths.push(fileUriToPath(trimmed));
    } else if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
      paths.push(trimmed);
    }
  }

  return paths;
}

/**
 * Extracts file or directory paths from clipboard data or drag-and-drop DataTransfer.
 */
export function extractPathsFromClipboardData(
  clipboardData: DataTransfer | null,
  options?: ExtractPathsOptions
): string[] {
  if (!clipboardData) return [];

  const foundPaths: string[] = [];

  // 1. Check for Electron / desktop runtime `File.path` property on files
  const files = Array.from(clipboardData.files ?? []);
  for (const file of files) {
    const filePath = (file as unknown as { path?: unknown }).path;
    if (typeof filePath === "string" && filePath.trim()) {
      foundPaths.push(filePath.trim());
    }
  }

  if (foundPaths.length > 0) {
    return Array.from(new Set(foundPaths));
  }

  // 2. Check DataTransferItem.getAsFile() if files didn't have path
  const items = Array.from(clipboardData.items ?? []);
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      const filePath = (file as unknown as { path?: unknown })?.path;
      if (typeof filePath === "string" && filePath.trim()) {
        foundPaths.push(filePath.trim());
      }
    }
  }

  if (foundPaths.length > 0) {
    return Array.from(new Set(foundPaths));
  }

  // 3. Check specialized MIME types (text/uri-list, Linux file managers, macOS file-url)
  for (const mimeType of LINUX_CLIPBOARD_TYPES) {
    try {
      const data = clipboardData.getData(mimeType);
      if (data) {
        const paths = extractPathsFromText(data);
        if (paths.length > 0) {
          foundPaths.push(...paths);
        }
      }
    } catch {
      // Some browsers throw when accessing unsupported custom MIME types
    }
  }

  if (foundPaths.length > 0) {
    return Array.from(new Set(foundPaths));
  }

  // 4. Check text/plain if it contains file:// URIs
  try {
    const textPlain = clipboardData.getData("text/plain") || clipboardData.getData("text");
    if (textPlain) {
      const lines = textPlain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const fileUriLines = lines.filter((l) => l.startsWith("file://"));
      if (fileUriLines.length > 0 && fileUriLines.length === lines.length) {
        for (const uri of fileUriLines) {
          foundPaths.push(fileUriToPath(uri));
        }
      }
    }
  } catch {
    // Ignore data access error
  }

  if (foundPaths.length > 0) {
    return Array.from(new Set(foundPaths));
  }

  // 5. Fallback to file names if enabled
  if (options?.fallbackToFileName && files.length > 0) {
    for (const file of files) {
      if (file.name) {
        foundPaths.push(file.name);
      }
    }
  }

  return Array.from(new Set(foundPaths));
}

/**
 * Formats a list of paths into a string suitable for pasting into a text input or textarea.
 * Quotes individual paths if they contain whitespace.
 */
export function formatPathsForInput(paths: string[], delimiter = " "): string {
  if (!paths || paths.length === 0) return "";
  if (paths.length === 1) return paths[0];

  return paths
    .map((p) => {
      const trimmed = p.trim();
      if (/\s/.test(trimmed) && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
        return `"${trimmed}"`;
      }
      return trimmed;
    })
    .join(delimiter);
}
