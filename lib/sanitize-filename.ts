// Windows reserved filenames (case-insensitive)
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Sanitize a user-provided filename for safe filesystem storage.
 *
 * Order of operations:
 * 1) Strip path separators first (prevent dir traversal via / or \)
 * 2) Remove null bytes and control characters
 * 3) Reject empty or dot-only names
 * 4) Reject Windows reserved names
 * 5) Limit to 255 bytes (common filesystem max)
 */
export function sanitizeFilename(name: string): string | null {
  // Strip path separators
  let sanitized = name.replace(/[/\\]/g, "_");

  // Remove null bytes and control characters
  sanitized = sanitized.replace(/[\x00-\x1f]/g, "");

  if (!sanitized) return null;

  // Reject dot-only names (., ..)
  if (/^\.+$/.test(sanitized)) return null;

  // Reject Windows reserved names (check without extension)
  const nameWithoutExt = sanitized.includes(".") ? sanitized.split(".")[0] : sanitized;
  if (RESERVED_NAMES.has(nameWithoutExt.toLowerCase())) return null;

  // Limit filename length (255 bytes is common max)
  const encoder = new TextEncoder();
  if (encoder.encode(sanitized).length > 255) {
    const extIdx = sanitized.lastIndexOf(".");
    if (extIdx > 0) {
      const base = sanitized.substring(0, extIdx);
      const ext = sanitized.substring(extIdx);
      const maxBase = 255 - encoder.encode(ext).length;
      if (maxBase <= 0) return null;
      sanitized = base.substring(0, maxBase) + ext;
    } else {
      sanitized = sanitized.substring(0, 255);
    }
  }

  return sanitized;
}
