// Next.js buffers the request body whenever a middleware/proxy is present and
// caps that buffer at 10 MB by default. Pi Web's upload route accepts up to
// 100 MB, so the buffer must be raised above that or large uploads are silently
// truncated and fail with "Failed to parse body as FormData."

export const DEFAULT_MAX_BODY_SIZE_BYTES = 128 * 1024 * 1024;
export const MAX_BODY_SIZE_ENV = "PI_WEB_MAX_BODY_SIZE";

const UNIT_MULTIPLIERS = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;

/**
 * Parse a human-readable size such as `128mb`, `1gb`, or a raw byte count.
 * Returns `null` for blank or malformed input.
 *
 * @param {string | undefined} value
 * @returns {number | null}
 */
export function parseMaxBodySize(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = SIZE_PATTERN.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2] ? UNIT_MULTIPLIERS[match[2].toLowerCase()] : 1;
  const bytes = Math.round(amount * multiplier);
  if (!Number.isSafeInteger(bytes) || bytes < 1) return null;
  return bytes;
}

/**
 * Resolve `PI_WEB_MAX_BODY_SIZE` into a byte count. Blank/unset values use the
 * default; invalid values fall back to the default with a warning.
 *
 * @param {string | undefined} value
 * @returns {number}
 */
export function resolveMaxBodySize(value = process.env[MAX_BODY_SIZE_ENV]) {
  if (value === undefined || value.trim() === "") return DEFAULT_MAX_BODY_SIZE_BYTES;
  const parsed = parseMaxBodySize(value);
  if (parsed === null) {
    console.warn(
      `[pi-web] invalid ${MAX_BODY_SIZE_ENV} "${value}", falling back to ${DEFAULT_MAX_BODY_SIZE_BYTES} bytes`,
    );
    return DEFAULT_MAX_BODY_SIZE_BYTES;
  }
  return parsed;
}
