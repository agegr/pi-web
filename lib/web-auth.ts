import { createHash, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { getActivePassword } from "./runtime-password";
import { signSession, verifySession } from "./session-store";

export const PI_WEB_AUTH_USERNAME = "pi";

/** Cookie name used for "remember this device" after a successful Basic Auth. */
export const SESSION_COOKIE_NAME = "pi-web-session";

/** 30 days. Matches the cookie Max-Age; same number is written into the payload. */
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

/** Renew the cookie when fewer than this many seconds remain (7 days). */
export const SESSION_RENEW_BELOW_SECONDS = 7 * 24 * 3600;

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(
  password: string | undefined = getActivePassword(),
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = getActivePassword(),
): boolean {
  if (!isWebPasswordEnabled(password) || !authorization) return false;

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
  const passwordMatches = secretsEqual(suppliedPassword, password);
  return usernameMatches && passwordMatches;
}

/**
 * Issue a fresh session cookie on `response`. Called from the proxy after a
 * successful Basic Auth so the browser can send it back on the next request
 * and skip the password prompt.
 */
export function attachSessionCookie(
  response: NextResponse,
  expiresAt: number,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, signSession(expiresAt), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Parse a `Cookie:` header, extract the session cookie if present, and
 * return the cookie's embedded expiration time (unix-ms) if it verifies,
 * or `null` if the cookie is missing, malformed, or expired.
 */
export function readSessionExpiry(cookieHeader: string | null): number | null {
  if (!cookieHeader) return null;
  // Header can carry many cookies; only the one we care about matters.
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== SESSION_COOKIE_NAME) continue;
    return verifySession(trimmed.slice(eq + 1));
  }
  return null;
}