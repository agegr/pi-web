interface LocalFileClickEvent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function shouldOpenLocalFileInApp(event: LocalFileClickEvent): boolean {
  // Browsers block file:// navigation from Pi Web's HTTP origin, so the
  // platform primary modifier must use the same in-app preview as a plain click.
  return !event.defaultPrevented
    && event.button === 0
    && !event.shiftKey
    && !event.altKey;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

/** Whether a path is written the way Windows writes one. */
function isWindowsPath(filePath: string | undefined): boolean {
  return !!filePath && (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\"));
}

// Git Bash, MSYS2 and Cygwin spell a Windows drive as `/<letter>/…`, and WSL as
// `/mnt/<letter>/…`; Cygwin's own prefix is `/cygdrive/<letter>/…`. A Windows
// session's bash tool prints those forms verbatim, so a path quoted from a tool
// call — a "Files changed" chip, a written-file card, a path in a reply — names
// `D:/…` through it. Reading the leading segment as a real folder showed
// `D:/d/work/…` on screen and made the file API answer 403.
const SHELL_DRIVE_PATH = /^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])(?:\/(.*))?$/;

/**
 * Rewrite a shell-style drive path (`/d/work`, `/mnt/d/work`, `/cygdrive/d/work`)
 * to the slash form `D:/work`, matching what pi does to the paths its bash tool
 * reports (`normalizeWindowsShellPath`).
 *
 * `windowsShellPath()` in `lib/http-dispatcher.ts` is the server-side twin: same
 * rule, native backslashes, and it also refuses a path holding one. That module
 * loads `node:fs`, so this client-side copy is not an import of it.
 *
 * Decided by the caller's own path form — a Windows base directory or a
 * `<letter>:/` href — never by `process.platform`, because this module also runs
 * in the browser. Below a POSIX cwd a single-letter folder at the root is a real
 * folder and keeps meaning that, so call this only after the windows-style
 * question is answered.
 */
export function normalizeShellDrivePath(filePath: string): string {
  if (!filePath.startsWith("/") || filePath.startsWith("//")) return filePath;
  const match = filePath.match(SHELL_DRIVE_PATH);
  if (!match) return filePath;
  const [, drive, rest] = match;
  return `${drive!.toUpperCase()}:/${rest ?? ""}`;
}

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?:(?::|-)\d+)?$/, "");
}

function normalizeLocalPath(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const isWindowsDrive = /^[a-zA-Z]:\//.test(normalized);
  const isUnc = normalized.startsWith("//");
  const leadingSlash = normalized.startsWith("/") && !isWindowsDrive && !isUnc;
  const parts: string[] = [];

  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!leadingSlash && !isWindowsDrive && !isUnc) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join("/");
  if (isWindowsDrive) return joined;
  if (isUnc) return `//${joined}`;
  return leadingSlash ? `/${joined}` : joined;
}

function isPathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeLocalPath(candidate).replace(/\/+$/, "");
  const normalizedRoot = normalizeLocalPath(root).replace(/\/+$/, "");
  const useCaseInsensitive = /^[a-zA-Z]:\//.test(normalizedCandidate) || /^[a-zA-Z]:\//.test(normalizedRoot);
  const filePath = useCaseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const rootPath = useCaseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function looksLikeRelativeFileHref(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("?")) return false;
  if (href.startsWith("./") || href.startsWith("../")) return true;
  if (href.includes("/")) return true;
  return /(^|\/)\.?[^/]+\.[^/.]+$/.test(href);
}

function fileUrlToPath(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "file:") return null;
    const pathname = safeDecode(url.pathname);
    if (url.hostname) {
      return `//${url.hostname}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    }
    if (/^\/[a-zA-Z]:\//.test(pathname)) return pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

export function resolveLocalFileHref(
  href: string | undefined,
  baseDir?: string,
  relativeRoot = baseDir,
): string | null {
  if (!href) return null;

  const cleanHref = href.split("#", 1)[0].split("?", 1)[0].trim();
  if (!cleanHref) return null;

  let candidate: string | null = null;
  let candidateKind: "absolute" | "relative" | null = null;
  const decodedHref = safeDecode(cleanHref);
  const isBackslashUncPath = decodedHref.startsWith("\\\\");
  const normalizedHref = normalizeFilePathSlashes(decodedHref);
  const lowerHref = normalizedHref.toLowerCase();

  if (lowerHref.startsWith("/api/") || lowerHref.startsWith("/_next/")) return null;
  if (!isBackslashUncPath && normalizedHref.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(normalizedHref) && !lowerHref.startsWith("file:") && !/^[a-zA-Z]:\//.test(normalizedHref)) {
    return null;
  }

  if (lowerHref.startsWith("file:")) {
    // Decode only the parsed pathname so encoded delimiters stay in the filename.
    candidate = fileUrlToPath(cleanHref);
    candidateKind = candidate ? "absolute" : null;
  } else if (/^[a-zA-Z]:\//.test(normalizedHref)) {
    candidate = normalizedHref;
    candidateKind = "absolute";
  } else if (normalizedHref.startsWith("/")) {
    // A Windows session's shell prints a drive as `/d/…`; below a Windows base that
    // is the drive, not a folder under the filesystem root.
    candidate = isWindowsPath(baseDir) ? normalizeShellDrivePath(normalizedHref) : normalizedHref;
    candidateKind = "absolute";
  } else if (baseDir && looksLikeRelativeFileHref(normalizedHref)) {
    candidate = `${normalizeFilePathSlashes(baseDir).replace(/\/+$/, "")}/${normalizedHref}`;
    candidateKind = "relative";
  }

  if (!candidate) return null;

  const filePath = stripLineSuffix(normalizeLocalPath(candidate));
  if (candidateKind === "relative" && relativeRoot && !isPathInside(filePath, relativeRoot)) return null;
  return filePath;
}

const PDF_PAGE_FRAGMENT = /^page=(\d+)$/i;

/**
 * Read the PDF Open Parameters page selector (`#page=12`) from a markdown href.
 *
 * Only the `page` fragment is understood; every other fragment is ignored so
 * that unknown anchors keep their previous behaviour. Returns null when the href
 * has no usable page fragment.
 */
export function parsePdfPageFragment(href: string | undefined): number | null {
  if (!href) return null;
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return null;
  const match = href.slice(hashIndex + 1).trim().match(PDF_PAGE_FRAGMENT);
  if (!match) return null;
  const page = Number.parseInt(match[1], 10);
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** Resolve a filesystem path without applying URL or source-location syntax. */
export function resolveLocalFilePath(filePath: string | undefined, baseDir?: string): string | null {
  if (!filePath) return null;

  const windowsStyle = isWindowsPath(filePath) || isWindowsPath(baseDir);
  const normalizeSlashes = (value: string) => windowsStyle ? value.replace(/\\/g, "/") : value;
  const normalizedPath = normalizeSlashes(filePath);
  const normalizedBase = baseDir ? normalizeSlashes(baseDir).replace(/\/+$/, "") : undefined;

  const isDriveAbsolute = /^[a-zA-Z]:\//.test(normalizedPath);
  const isUncAbsolute = normalizedPath.startsWith("//");
  // A Windows shell prints a drive as `/d/…`; that is absolute, not a folder beside
  // the cwd's drive. Joining it produced `D:/d/work/…`, which the file API refused.
  const shellDrivePath = windowsStyle ? normalizeShellDrivePath(normalizedPath) : normalizedPath;
  let candidate: string;

  if (isDriveAbsolute || isUncAbsolute || shellDrivePath !== normalizedPath) {
    candidate = shellDrivePath;
  } else if (normalizedPath.startsWith("/")) {
    const windowsRoot = normalizedBase?.match(/^([a-zA-Z]:)(?:\/|$)/)?.[1]
      ?? normalizedBase?.match(/^(\/\/[^/]+\/[^/]+)(?:\/|$)/)?.[1];
    candidate = windowsRoot ? `${windowsRoot}${normalizedPath}` : normalizedPath;
  } else {
    if (!normalizedBase) return null;
    candidate = `${normalizedBase}/${normalizedPath}`;
  }

  return normalizeLocalPath(candidate);
}
