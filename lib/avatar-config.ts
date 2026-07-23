export const AVATAR_CONFIG_ROLES = ["user", "assistant", "tool"] as const;

export type AvatarConfigRole = (typeof AVATAR_CONFIG_ROLES)[number];
export type AvatarConfig = Record<AvatarConfigRole, string | null>;

/** Image MIME types accepted by the upload boundary. SVG and other formats
 *  are intentionally excluded: SVG can carry active content and is parsed
 *  differently by image decoders, so it is not a safe upload format here. */
export const AVATAR_DATA_URL_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarDataUrlMime = (typeof AVATAR_DATA_URL_MIME_TYPES)[number];

/** Maximum encoded avatar data URL size in bytes (2 MB). The data URL is
 *  stored verbatim inside `<cwd>/.pi/avatars.json`, so capping the encoded
 *  payload keeps the on-disk file small and rejects oversized persisted data. */
export const AVATAR_DATA_URL_MAX_BYTES = 2 * 1024 * 1024;

/** Loose canonical form: `data:image/<png|jpeg|webp>;base64,<payload>`.
 *  Whitespace inside the base64 payload is tolerated. Size and decoding
 *  checks live outside the regex so they can fail fast on huge inputs. */
const AVATAR_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

export function createEmptyAvatarConfig(): AvatarConfig {
  return {
    user: null,
    assistant: null,
    tool: null,
  };
}

/**
 * Keep only supported role values while always returning a complete record.
 * Image-format and payload validation belongs to the upload boundary; loading
 * only needs to tolerate absent keys and unexpected persisted values safely.
 */
export function normalizeAvatarConfig(value: unknown): AvatarConfig {
  const normalized = createEmptyAvatarConfig();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return normalized;
  }

  const candidate = value as Record<string, unknown>;
  for (const role of AVATAR_CONFIG_ROLES) {
    const roleValue = candidate[role];
    if (typeof roleValue === "string" || roleValue === null) {
      normalized[role] = roleValue;
    }
  }
  return normalized;
}

export function parseAvatarConfig(source: string | null | undefined): AvatarConfig {
  if (source === null || source === undefined) return createEmptyAvatarConfig();
  try {
    return normalizeAvatarConfig(JSON.parse(source) as unknown);
  } catch {
    return createEmptyAvatarConfig();
  }
}

export interface AvatarDataUrlValidationOk {
  ok: true;
  mime: AvatarDataUrlMime;
  /** Base64 payload with whitespace stripped. */
  base64: string;
}

export interface AvatarDataUrlValidationFail {
  ok: false;
  reason: string;
}

export type AvatarDataUrlValidation = AvatarDataUrlValidationOk | AvatarDataUrlValidationFail;

/**
 * Validate that a value is a supported PNG/JPEG/WebP data URL. Returns a
 * discriminated result rather than throwing so the upload boundary can
 * surface a clear error to the UI without crashing the request.
 *
 * The size check runs before the regex match so oversized payloads are
 * rejected without paying for a full-string scan.
 */
export function validateAvatarDataUrl(value: unknown): AvatarDataUrlValidation {
  if (typeof value !== "string") {
    return { ok: false, reason: "avatar value must be a string" };
  }
  if (value.length > AVATAR_DATA_URL_MAX_BYTES) {
    return {
      ok: false,
      reason: `avatar data URL exceeds ${AVATAR_DATA_URL_MAX_BYTES}-byte limit`,
    };
  }
  const match = AVATAR_DATA_URL_RE.exec(value);
  if (!match) {
    return { ok: false, reason: "avatar must be a data:image/(png|jpeg|webp);base64 URL" };
  }
  const mime = `image/${match[1].toLowerCase()}` as AvatarDataUrlMime;
  const base64 = match[2].replace(/\s+/g, "");
  if (base64.length === 0) {
    return { ok: false, reason: "avatar data URL payload is empty" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, reason: "avatar data URL base64 payload is malformed" };
  }
  return { ok: true, mime, base64 };
}

/**
 * Validate a full three-role payload as it arrives at the persistence
 * boundary. Throws on the first invalid role so the server returns a clear
 * 400 with the offending role key.
 */
export function validateAvatarConfigPayload(value: unknown): AvatarConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("avatar config must be a JSON object");
  }
  const candidate = value as Record<string, unknown>;
  const result = createEmptyAvatarConfig();
  for (const role of AVATAR_CONFIG_ROLES) {
    const roleValue = candidate[role];
    if (roleValue === null) {
      result[role] = null;
      continue;
    }
    const validation = validateAvatarDataUrl(roleValue);
    if (!validation.ok) {
      throw new Error(`avatar "${role}" is invalid: ${validation.reason}`);
    }
    result[role] = `data:${validation.mime};base64,${validation.base64}`;
  }
  return result;
}
