import { createHash, timingSafeEqual } from "node:crypto";
import { envPasswordEnabled, hasStoredPasswordHash, verifyStoredPassword } from "./remote-access-config";
import { PI_WEB_AUTH_USERNAME } from "./web-auth-constants";

export { PI_WEB_AUTH_USERNAME };

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

function usingProcessEnvPassword(password: string | undefined): boolean {
  return password === undefined || password === process.env.PI_WEB_PASSWORD;
}

export function isWebPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_PASSWORD,
): boolean {
  if (envPasswordEnabled(password)) return true;
  return usingProcessEnvPassword(password) && hasStoredPasswordHash();
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = process.env.PI_WEB_PASSWORD,
): boolean {
  if (!authorization) return false;

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

  if (envPasswordEnabled(password)) {
    return usernameMatches && secretsEqual(suppliedPassword, password);
  }
  if (!usingProcessEnvPassword(password)) return false;
  return usernameMatches && verifyStoredPassword(suppliedPassword);
}
