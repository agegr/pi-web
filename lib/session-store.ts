import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Session cookie signed with a per-host HMAC key. Mirrors the role of Basic
 * Auth: a valid cookie grants access for the same duration that a correct
 * password would. The key is persisted to `~/.pi-web/session.key` so that
 * server restarts do not invalidate already-issued cookies.
 *
 * Cookie value layout: `<base64url(payload)>.<base64url(hmac)>`.
 * Payload is the JSON `{"exp": <unix-ms>}` — the only datum we need to
 * decide whether the cookie is still valid.
 */

const SESSION_KEY_DIR = join(homedir(), ".pi-web");
const SESSION_KEY_FILE = join(SESSION_KEY_DIR, "session.key");
const SESSION_KEY_BYTES = 32;
const SESSION_SEPARATOR = ".";

let cachedSecret: Buffer | null = null;

function ensureSessionSecret(): Buffer {
  if (cachedSecret !== null) return cachedSecret;
  try {
    const existing = readFileSync(SESSION_KEY_FILE);
    if (existing.length === SESSION_KEY_BYTES) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch {
    /* fall through to regeneration */
  }
  if (!existsSync(SESSION_KEY_DIR)) {
    mkdirSync(SESSION_KEY_DIR, { recursive: true, mode: 0o700 });
  }
  const fresh = randomBytes(SESSION_KEY_BYTES);
  writeSecretAtomic(SESSION_KEY_FILE, fresh);
  cachedSecret = fresh;
  return cachedSecret;
}

/**
 * Replace a file atomically without exposing the key through default
 * process permissions. The parent directory must already exist. Inlined
 * here to avoid a static intra-lib import; mirrors lib/atomic-file.ts:9.
 */
function writeSecretAtomic(path: string, contents: Buffer): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}-${randomBytes(16).toString("hex")}.tmp`);
  let failed = false;
  try {
    writeFileSync(tempPath, contents, {
      encoding: "binary",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(tempPath, path);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !failed) throw error;
    }
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): Buffer | null {
  // Canonical round-trip: refuse non-canonical base64 (padding, whitespace,
  // alternative alphabets). Mirrors the defense in web-auth.ts:25-31.
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0) return null;
    if (base64UrlEncode(decoded) !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface SessionPayload {
  /** Cookie expiration in unix milliseconds. */
  exp: number;
}

function encodePayload(payload: SessionPayload): string {
  return base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
}

function decodePayload(value: string): SessionPayload | null {
  const decoded = base64UrlDecode(value);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { exp?: unknown }).exp === "number" &&
      Number.isFinite((parsed as { exp: number }).exp)
    ) {
      return { exp: (parsed as { exp: number }).exp };
    }
    return null;
  } catch {
    return null;
  }
}

/** Sign a payload, returning the full cookie value (`payload.signature`). */
export function signSession(expiresAt: number): string {
  const payload: SessionPayload = { exp: expiresAt };
  const encodedPayload = encodePayload(payload);
  const signature = createHmac("sha256", ensureSessionSecret())
    .update(encodedPayload)
    .digest();
  return `${encodedPayload}${SESSION_SEPARATOR}${base64UrlEncode(signature)}`;
}

/**
 * Verify a cookie and return the embedded expiration time (ms) if valid,
 * or `null` if the cookie is malformed, the signature does not match, or
 * the cookie has already expired.
 */
export function verifySession(cookie: string): number | null {
  if (typeof cookie !== "string" || cookie.length === 0) return null;

  const separatorIndex = cookie.indexOf(SESSION_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === cookie.length - 1) return null;

  const encodedPayload = cookie.slice(0, separatorIndex);
  const encodedSignature = cookie.slice(separatorIndex + 1);

  const payload = decodePayload(encodedPayload);
  const signature = base64UrlDecode(encodedSignature);
  if (!payload || !signature || signature.length !== 32) return null;

  const expected = createHmac("sha256", ensureSessionSecret())
    .update(encodedPayload)
    .digest();
  if (!timingSafeEqual(signature, expected)) return null;

  if (payload.exp <= Date.now()) return null;
  return payload.exp;
}