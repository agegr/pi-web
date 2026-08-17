/**
 * Downloadable-extension set aligned with the DOWNLOADABLE_FILE_EXTENSIONS
 * list in Pake's injected script (https://github.com/tw93/Pake). Pake hijacks
 * clicks on `<a>` elements whose extension is in this set (and not a
 * previewable media type), replaying them through its own HTTP client; files
 * outside the set go through the native webview download path.
 *
 * The FileExplorer uses this to decide whether to attach a readable `download`
 * attribute (Pake prefers its value as the saved filename, which fixes
 * percent-encoded Chinese filenames) — only files Pake will hijack need it.
 *
 * This module is used by client components, so it must not depend on node:path.
 * Note: keep in sync when Pake updates its list.
 */
export const PAKE_DOWNLOADABLE_EXTENSIONS: ReadonlySet<string> = new Set([
 // documents
 "pdf",
 "doc",
 "docx",
 "xls",
 "xlsx",
 "ppt",
 "pptx",
 "txt",
 "rtf",
 "odt",
 "ods",
 "odp",
 "pages",
 "numbers",
 "key",
 "epub",
 "mobi",
 // archives
 "zip",
 "rar",
 "7z",
 "tar",
 "gz",
 "gzip",
 "bz2",
 "xz",
 "lzma",
 "deb",
 "rpm",
 "pkg",
 "msi",
 "exe",
 "dmg",
 "apk",
 "ipa",
 // data
 "csv",
 "sql",
 "db",
 "sqlite",
 // scripts
 "sh",
 "bat",
 "ps1",
 // fonts
 "ttf",
 "otf",
 "woff",
 "woff2",
 "eot",
 // design
 "ai",
 "psd",
 "sketch",
 "fig",
 "xd",
 // system
 "iso",
 "img",
 "bin",
 "torrent",
 "jar",
 "war",
 "indd",
 "fla",
 "swf",
 "raw",
]);

/**
 * Previewable media types Pake treats as native (images/audio/video) — these
 * are never hijacked even if the extension looks downloadable.
 */
export const PAKE_PREVIEWABLE_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
 "png",
 "jpg",
 "jpeg",
 "gif",
 "webp",
 "svg",
 "bmp",
 "tiff",
 "tif",
 "avif",
 "heic",
 "heif",
 "mp4",
 "webm",
 "mov",
 "m4v",
 "mkv",
 "avi",
 "ogv",
 "mp3",
 "wav",
 "ogg",
 "flac",
 "aac",
 "m4a",
]);

/**
 * Whether a file will be hijacked by Pake as a download (extension in the
 * downloadable set and not a previewable media type).
 *
 * @param filePath - absolute file path or file name
 * @returns true when Pake will hijack the download
 */
export function isPakeInterceptedDownload(filePath: string): boolean {
 const base = (filePath.split("/").pop() ?? "").toLowerCase();
 const dots = base.split(".");
 const ext = dots.length > 1 ? (dots.pop() ?? "") : "";
 if (!ext) return false;
 if (PAKE_PREVIEWABLE_MEDIA_EXTENSIONS.has(ext)) return false;
 return PAKE_DOWNLOADABLE_EXTENSIONS.has(ext);
}
