import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PI_WEB_AUTH_USERNAME = "pi";
export const PI_WEB_SESSION_COOKIE = "pi_web_session";
export const PI_WEB_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_PASSWORD,
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidWebPassword(
  suppliedPassword: string,
  password = process.env.PI_WEB_PASSWORD,
): boolean {
  return isWebPasswordEnabled(password) && secretsEqual(suppliedPassword, password);
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = process.env.PI_WEB_PASSWORD,
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
  const passwordMatches = isValidWebPassword(suppliedPassword, password);
  return usernameMatches && passwordMatches;
}

function sessionSignature(payload: string, password: string): string {
  return createHmac("sha256", password).update(`pi-web-session:${payload}`, "utf8").digest("hex");
}

export function createWebSessionToken(
  password: string,
  now = Date.now(),
  nonce = randomBytes(16).toString("hex"),
): string {
  const payload = `v1.${Math.floor(now / 1000) + PI_WEB_SESSION_MAX_AGE}.${nonce}`;
  return `${payload}.${sessionSignature(payload, password)}`;
}

export function isValidWebSessionToken(
  token: string | undefined,
  password = process.env.PI_WEB_PASSWORD,
  now = Date.now(),
): boolean {
  if (!token || !isWebPasswordEnabled(password)) return false;

  const match = /^(v1\.(\d+)\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;

  const expiresAt = Number(match[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  return secretsEqual(match[3], sessionSignature(match[1], password));
}
