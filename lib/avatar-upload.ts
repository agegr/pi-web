import {
  AVATAR_DATA_URL_MAX_BYTES,
  AVATAR_DATA_URL_MIME_TYPES,
} from "./avatar-config";

/** MIME types the client upload pipeline accepts. SVG and other formats
 *  are intentionally excluded because they cannot be decoded by the
 *  canvas resize step the same way PNG/JPEG/WebP can. */
export const AVATAR_UPLOAD_ACCEPTED_MIME_TYPES = AVATAR_DATA_URL_MIME_TYPES;
export { AVATAR_DATA_URL_MAX_BYTES };

export type AvatarUploadAcceptedMime = (typeof AVATAR_UPLOAD_ACCEPTED_MIME_TYPES)[number];

export interface AvatarUploadDeps {
  /** Read the raw File into a base64 data URL (no resize). */
  readDataUrl: (file: File) => Promise<string>;
  /** Resize / re-encode the data URL so it fits the configured avatar size. */
  resizeDataUrl: (dataUrl: string) => Promise<string>;
}

export type AvatarUploadResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: string };

/**
 * Validate, decode, resize, and size-check a user-selected avatar file.
 *
 * Returns a discriminated result so the React upload handler can surface a
 * clear error without touching the draft state. On rejection the caller
 * must leave the draft (and any saved config) untouched - only the success
 * branch returns a data URL that is safe to assign to a role slot.
 *
 * The decode and resize steps use injected dependencies so this helper can
 * be exercised under node test without a browser.
 */
export async function processAvatarUpload(
  file: File,
  deps: AvatarUploadDeps,
): Promise<AvatarUploadResult> {
  const accepted = AVATAR_UPLOAD_ACCEPTED_MIME_TYPES as readonly string[];
  if (!accepted.includes(file.type)) {
    return {
      ok: false,
      reason: `Unsupported file type: ${file.type || "unknown"}`,
    };
  }
  let resized: string;
  try {
    const raw = await deps.readDataUrl(file);
    resized = await deps.resizeDataUrl(raw);
  } catch (resizeError) {
    const message =
      resizeError instanceof Error ? resizeError.message : String(resizeError);
    return {
      ok: false,
      reason: `Could not decode image: ${message}`,
    };
  }
  if (typeof resized !== "string" || resized.length === 0) {
    return { ok: false, reason: "Could not decode image: empty result" };
  }
  if (resized.length > AVATAR_DATA_URL_MAX_BYTES) {
    return {
      ok: false,
      reason: `avatar data URL exceeds ${AVATAR_DATA_URL_MAX_BYTES}-byte limit`,
    };
  }
  return { ok: true, dataUrl: resized };
}
