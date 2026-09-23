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

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?::\d+)?$/, "");
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
    candidate = normalizedHref;
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

  const windowsStyle = /^[a-zA-Z]:[\\/]/.test(filePath) ||
    filePath.startsWith("\\\\") ||
    (baseDir !== undefined && (/^[a-zA-Z]:[\\/]/.test(baseDir) || baseDir.startsWith("\\\\")));
  const normalizeSlashes = (value: string) => windowsStyle ? value.replace(/\\/g, "/") : value;
  const normalizedPath = normalizeSlashes(filePath);
  const normalizedBase = baseDir ? normalizeSlashes(baseDir).replace(/\/+$/, "") : undefined;

  const isDriveAbsolute = /^[a-zA-Z]:\//.test(normalizedPath);
  const isUncAbsolute = normalizedPath.startsWith("//");
  let candidate: string;

  if (isDriveAbsolute || isUncAbsolute) {
    candidate = normalizedPath;
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

const INLINE_PATH_MAX_LENGTH = 260;
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;
/** A file-looking tail: an alphabetic extension, so `v0.9.2` is not a path. */
const HAS_FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/**
 * Resolve an inline-code span that is nothing but a filesystem path.
 *
 * Inline code carries prose constants (`npm test`, `application/json`) far more
 * often than paths, so the match stays deliberately narrow: a single token that
 * is either rooted (drive letter, UNC, or `/…`) or a slash-separated relative
 * path whose last segment looks like a file. Bare names (`Node.js`) and
 * slash-only fragments (`read/write`) stay plain code. Rooted Windows paths may
 * contain spaces (`C:\Program Files\app`); anything else may not.
 */
export function resolveInlineCodePath(text: string, baseDir?: string): string | null {
  const candidate = text.trim();
  if (!candidate || candidate.length > INLINE_PATH_MAX_LENGTH) return null;
  if (candidate.startsWith("-")) return null;
  if (candidate.includes("://")) return null;

  const isWindowsRooted = WINDOWS_DRIVE_PATH.test(candidate) || WINDOWS_UNC_PATH.test(candidate);
  if (/\s/.test(candidate) && !isWindowsRooted) return null;

  const withoutTrailingSlash = candidate.replace(/[\\/]+$/, "");
  if (!withoutTrailingSlash) return null;

  if (isWindowsRooted || candidate.startsWith("/")) {
    // `/api/files`, `/_next/…` are app routes, not files on disk.
    if (/^\/(api|_next)\//i.test(candidate)) return null;
    return resolveLocalFilePath(candidate, baseDir);
  }

  if (!candidate.includes("/") && !candidate.includes("\\")) return null;
  if (!HAS_FILE_EXTENSION.test(withoutTrailingSlash)) return null;

  const resolved = resolveLocalFilePath(candidate, baseDir);
  if (!resolved) return null;
  // A relative path must stay inside the directory it is resolved against.
  if (baseDir && !isPathInside(resolved, baseDir)) return null;
  return resolved;
}
