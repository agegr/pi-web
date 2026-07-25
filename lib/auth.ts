import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { chmodSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "fs";
import { homedir } from "os";
import path from "path";

const CONFIG_PATH = process.env.PI_WEB_AUTH_CONFIG_PATH
  || path.join(homedir(), ".pi", "agent", "pi-web-auth.json");
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_COOKIE_NAME = "pi-web-session";

interface AuthConfig {
  version: 1;
  salt: string;
  passwordHash: string;
  sessionSecret: string;
}

function readConfig(): AuthConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AuthConfig;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

function passwordHash(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

export function authIsConfigured(): boolean {
  return readConfig() !== null;
}

export function initializeAuth(password: string): "created" | "exists" {
  const directory = path.dirname(CONFIG_PATH);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const salt = randomBytes(16);
  const config: AuthConfig = {
    version: 1,
    salt: salt.toString("base64url"),
    passwordHash: passwordHash(password, salt).toString("base64url"),
    sessionSecret: randomBytes(32).toString("base64url"),
  };

  // wx 保证并发初始化时只有首个请求能够创建认证配置。
  let descriptor: number;
  try {
    descriptor = openSync(CONFIG_PATH, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw error;
  }

  try {
    writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  chmodSync(CONFIG_PATH, 0o600);
  return "created";
}

export function verifyPassword(password: string): boolean {
  const config = readConfig();
  if (!config) return false;
  const expected = Buffer.from(config.passwordHash, "base64url");
  const actual = passwordHash(password, Buffer.from(config.salt, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(now = Date.now()): string {
  const config = readConfig();
  if (!config) throw new Error("Authentication is not configured");
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", Buffer.from(config.sessionSecret, "base64url"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const config = readConfig();
  if (!config) return false;
  const [expiresAtText, providedSignature, extra] = token.split(".");
  if (!expiresAtText || !providedSignature || extra || !/^\d+$/.test(expiresAtText)) return false;
  if (Number(expiresAtText) <= Math.floor(now / 1000)) return false;

  const expectedSignature = createHmac("sha256", Buffer.from(config.sessionSecret, "base64url"))
    .update(expiresAtText)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
  } catch {
    return false;
  }
  return expectedSignature.length === provided.length && timingSafeEqual(expectedSignature, provided);
}

export const authSessionMaxAge = SESSION_MAX_AGE_SECONDS;
