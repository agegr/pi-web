import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Download token TTL in milliseconds. Covers the hover-to-click gap. */
export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60_000;

/** Purpose string bound into every signature so a token cannot be reused elsewhere. */
const DOWNLOAD_PURPOSE = "download";

declare global {
 var __piDownloadSecret: string | undefined;
}

/**
 * Resolve the signing secret for download tokens.
 *
 * Prefers the PI_WEB_DOWNLOAD_SECRET environment variable (an explicit
 * operator choice for cross-restart/process stability). Otherwise a random
 * 32-byte key is generated once and cached on globalThis — issuance and
 * verification always happen in the same process, so a random secret is
 * sufficient, and keeping it in memory (never persisted) shrinks exposure.
 *
 * @returns the signing secret
 */
export function getDownloadSecret(): string {
 const fromEnv = process.env.PI_WEB_DOWNLOAD_SECRET;
 if (fromEnv) return fromEnv;
 if (!globalThis.__piDownloadSecret) {
  globalThis.__piDownloadSecret = randomBytes(32).toString("hex");
 }
 return globalThis.__piDownloadSecret;
}

/**
 * Create a one-time download token for a download target.
 *
 * The token is `<expiry_epoch_ms>.<hmac-sha256 hex>` where the signature input
 * is `pathname|exp|download`. It therefore cannot be replayed against another
 * path or purpose, and tampering with the expiry invalidates the signature.
 *
 * @param secret - the signing secret (from getDownloadSecret)
 * @param pathname - API path of the download target, e.g. `/api/files/home/user/report.xlsx` (URL-encoded form)
 * @param now - current time in ms (injectable for tests)
 * @returns the `<exp>.<hex>` download token
 */
export function createDownloadToken(
 secret: string,
 pathname: string,
 now: number = Date.now(),
): string {
 const exp = now + DOWNLOAD_TOKEN_TTL_MS;
 const signature = sign(secret, pathname, exp);
 return `${exp}.${signature}`;
}

/**
 * Verify a download token.
 *
 * @param secret - the signing secret (same one used at issuance)
 * @param pathname - the API path of the current request; must exactly match the one bound at issuance
 * @param token - the token carried by the request
 * @param now - current time in ms (injectable for tests)
 * @returns true when the token is valid; false for malformed, expired, or tampered tokens
 */
export function verifyDownloadToken(
 secret: string,
 pathname: string,
 token: string | null | undefined,
 now: number = Date.now(),
): boolean {
 if (typeof token !== "string" || !token) return false;
 if (!pathname) return false;

 const dotIndex = token.lastIndexOf(".");
 if (dotIndex <= 0) return false;

 const expText = token.slice(0, dotIndex);
 const signature = token.slice(dotIndex + 1);
 if (!/^\d+$/.test(expText)) return false;
 if (!/^[0-9a-f]{64}$/i.test(signature)) return false;

 const exp = Number(expText);
 if (!Number.isSafeInteger(exp)) return false;
 // Expired tokens are rejected (a longer expiry cannot be forged: tampering
 // with exp breaks the signature).
 if (now > exp) return false;

 const expected = sign(secret, pathname, exp);
 return timingSafeEqual(
  Buffer.from(signature, "hex"),
  Buffer.from(expected, "hex"),
 );
}

/**
 * Compute the token signature.
 *
 * @param secret - the signing secret
 * @param pathname - the API path of the download target
 * @param exp - expiry time in ms
 * @returns HMAC-SHA256 hex digest
 */
function sign(secret: string, pathname: string, exp: number): string {
 return createHmac("sha256", secret)
  .update(`${pathname}|${exp}|${DOWNLOAD_PURPOSE}`)
  .digest("hex");
}
