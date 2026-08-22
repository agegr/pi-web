import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PI_WEB_AUTH_USERNAME = "pi";
export const PI_WEB_SESSION_COOKIE = "pi_web_session";

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  try {
    return timingSafeEqual(hashSecret(actual), hashSecret(expected));
  } catch {
    return false;
  }
}

export function isWebPasswordEnabled(password?: string): password is string {
  const effectivePassword =
    arguments.length === 0 ? process.env.PI_WEB_PASSWORD : password;
  return typeof effectivePassword === "string" && effectivePassword.length > 0;
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password?: string,
): boolean {
  const effectivePassword =
    arguments.length >= 2 ? password : process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(effectivePassword) || !authorization) return false;

  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return false;

  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return false;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return false;
  }

  const separator = credentials.indexOf(":");
  if (separator === -1) return false;

  const username = credentials.slice(0, separator);
  const suppliedPassword = credentials.slice(separator + 1);
  const usernameMatches = secretsEqual(username, PI_WEB_AUTH_USERNAME);
  const passwordMatches = secretsEqual(suppliedPassword, effectivePassword);
  return usernameMatches && passwordMatches;
}

/**
 * Generate a signed session token for cookie-based authentication.
 * Token structure: `${expiresAt}.${signature}`
 */
export function generateSessionToken(
  password?: string,
  maxAgeSeconds = 30 * 24 * 60 * 60, // 30 days
): string | null {
  const effectivePassword =
    arguments.length >= 1 && password !== undefined
      ? password
      : process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(effectivePassword)) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const signature = createHmac("sha256", effectivePassword)
    .update(`pi-web-session:${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

/**
 * Validate a signed session token.
 */
export function isValidSessionToken(
  token: string | null | undefined,
  password?: string,
): boolean {
  const effectivePassword =
    arguments.length >= 2 ? password : process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(effectivePassword) || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [expiresAtStr, signature] = parts;
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (Number.isNaN(expiresAt)) return false;

  // Check if expired
  if (Math.floor(Date.now() / 1000) > expiresAt) return false;

  const expectedSignature = createHmac("sha256", effectivePassword)
    .update(`pi-web-session:${expiresAt}`)
    .digest("hex");

  return secretsEqual(signature, expectedSignature);
}

/**
 * Verify either Basic Auth or Session Cookie.
 */
export function isValidWebAuth(
  authorization: string | null,
  cookieToken: string | null | undefined,
  password?: string,
): boolean {
  const effectivePassword =
    arguments.length >= 3 ? password : process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(effectivePassword)) return true;
  if (isValidSessionToken(cookieToken, effectivePassword)) return true;
  if (isValidBasicAuthorization(authorization, effectivePassword)) return true;
  return false;
}
