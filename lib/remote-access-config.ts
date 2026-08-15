import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { domainToASCII } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { PI_WEB_AUTH_USERNAME } from "./web-auth-constants";

export const REMOTE_ACCESS_SCHEMA_VERSION = 1;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

export type RemoteAccessPasswordSource = "file" | "env";

export type RemoteAccessSnapshot = {
  schemaVersion: 1;
  configPath: string;
  bindHostname: string;
  bindPort: string;
  allowedHosts: string[];
  envAllowedHosts: string[];
  passwordConfigured: boolean;
  passwordSource?: RemoteAccessPasswordSource;
  username: typeof PI_WEB_AUTH_USERNAME;
  configError?: string;
};

export type RemoteAccessWriteError = {
  ok: false;
  status: 400 | 403;
  code: "invalid_hostname" | "password_required" | "password_invalid" | "cannot_disable_password_remotely";
  error: string;
};

export type RemoteAccessWriteResult =
  | { ok: true; snapshot: RemoteAccessSnapshot }
  | RemoteAccessWriteError;

type StoredFile = {
  schemaVersion?: unknown;
  allowedHosts?: unknown;
  passwordHash?: unknown;
  [key: string]: unknown;
};

type FileCache =
  | { kind: "missing"; path: string; mtimeMs: number; ino: number }
  | { kind: "invalid"; path: string; mtimeMs: number; ino: number; configError: string }
  | { kind: "ok"; path: string; mtimeMs: number; ino: number; stored: StoredFile; allowedHosts: string[]; passwordHash: string | undefined };

let fileCache: FileCache | undefined;
const verifyCache = new Map<string, boolean>();
let verifyCacheHashRecord: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRemoteAccessConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web.json");
}

export function parseEnvAllowedHosts(
  value: string | undefined = process.env.PI_WEB_ALLOWED_HOSTS,
): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function envPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_PASSWORD,
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function parseAllowedHostname(value: string): { ok: true; hostname: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Hostname is required" };
  if (/\s/.test(trimmed)) return { ok: false, error: `Invalid hostname: ${trimmed}` };
  if (trimmed.includes("://")) return { ok: false, error: `Enter a hostname, not a URL: ${trimmed}` };
  if (trimmed.includes("*")) return { ok: false, error: `Wildcards are not allowed: ${trimmed}` };
  if (/[/?#@\\]/.test(trimmed)) return { ok: false, error: `Invalid hostname: ${trimmed}` };
  if (trimmed.includes(":")) return { ok: false, error: `Hostname must not include a port: ${trimmed}` };

  let ascii: string;
  try {
    ascii = domainToASCII(trimmed.replace(/\.$/, ""));
  } catch {
    return { ok: false, error: `Invalid hostname: ${trimmed}` };
  }
  if (!ascii) return { ok: false, error: `Invalid hostname: ${trimmed}` };
  if (ascii.length > 253) return { ok: false, error: `Hostname is too long: ${trimmed}` };
  if (isIP(ascii)) return { ok: false, error: `IP addresses are already allowed; enter a domain: ${trimmed}` };

  try {
    const parsed = new URL(`http://${ascii}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return { ok: false, error: `Invalid hostname: ${trimmed}` };
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname.includes(":")) return { ok: false, error: `Invalid hostname: ${trimmed}` };
    return { ok: true, hostname };
  } catch {
    return { ok: false, error: `Invalid hostname: ${trimmed}` };
  }
}

function normalizeHostList(values: unknown): string[] | { error: string; value?: string } {
  if (!Array.isArray(values)) return { error: "allowedHosts must be an array of hostnames" };
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") return { error: "allowedHosts must be an array of hostnames" };
    const parsed = parseAllowedHostname(value);
    if (!parsed.ok) return { error: parsed.error, value };
    if (seen.has(parsed.hostname)) continue;
    seen.add(parsed.hostname);
    hosts.push(parsed.hostname);
  }
  return hosts;
}

function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function parseScryptRecord(record: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | undefined {
  const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(record);
  if (!match) return undefined;
  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return undefined;
  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(match[4], "base64"),
      hash: Buffer.from(match[5], "base64"),
    };
  } catch {
    return undefined;
  }
}

function verifyCacheKey(password: string, record: string): string {
  return createHash("sha256").update(password, "utf8").update("\0").update(record, "utf8").digest("hex");
}

function resetVerifyCache(hashRecord: string | undefined): void {
  if (verifyCacheHashRecord === hashRecord) return;
  verifyCache.clear();
  verifyCacheHashRecord = hashRecord;
}

export function invalidateRemoteAccessCache(): void {
  fileCache = undefined;
  verifyCache.clear();
  verifyCacheHashRecord = undefined;
}

function readFileCache(path = getRemoteAccessConfigPath()): FileCache {
  let stats: ReturnType<typeof statSync> | undefined;
  try {
    stats = existsSync(path) ? statSync(path) : undefined;
  } catch {
    stats = undefined;
  }
  const mtimeMs = stats?.mtimeMs ?? 0;
  const ino = stats?.ino ?? 0;
  if (
    fileCache
    && fileCache.path === path
    && fileCache.mtimeMs === mtimeMs
    && fileCache.ino === ino
    && (stats ? fileCache.kind !== "missing" : fileCache.kind === "missing")
  ) {
    return fileCache;
  }

  if (!stats) {
    fileCache = { kind: "missing", path, mtimeMs: 0, ino: 0 };
    return fileCache;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      fileCache = { kind: "invalid", path, mtimeMs, ino, configError: "pi-web.json must be a JSON object" };
      return fileCache;
    }
    const hosts = Array.isArray(parsed.allowedHosts)
      ? parsed.allowedHosts.filter((value): value is string => typeof value === "string")
      : [];
    const allowedHosts: string[] = [];
    const seen = new Set<string>();
    for (const host of hosts) {
      const parsedHost = parseAllowedHostname(host);
      if (!parsedHost.ok) continue;
      if (seen.has(parsedHost.hostname)) continue;
      seen.add(parsedHost.hostname);
      allowedHosts.push(parsedHost.hostname);
    }
    const passwordHash = typeof parsed.passwordHash === "string" && parsed.passwordHash.length > 0
      ? parsed.passwordHash
      : undefined;
    fileCache = { kind: "ok", path, mtimeMs, ino, stored: parsed, allowedHosts, passwordHash };
    return fileCache;
  } catch (error) {
    fileCache = {
      kind: "invalid",
      path,
      mtimeMs,
      ino,
      configError: error instanceof Error ? error.message : String(error),
    };
    return fileCache;
  }
}

export function readRemoteAccessAllowedHosts(): string[] {
  const cache = readFileCache();
  return cache.kind === "ok" ? cache.allowedHosts : [];
}

export function readStoredPasswordHash(): string | undefined {
  const cache = readFileCache();
  return cache.kind === "ok" ? cache.passwordHash : undefined;
}

export function hasStoredPasswordHash(): boolean {
  return Boolean(readStoredPasswordHash());
}

export function verifyStoredPassword(password: string): boolean {
  const record = readStoredPasswordHash();
  if (!record) return false;
  resetVerifyCache(record);
  const key = verifyCacheKey(password, record);
  const cached = verifyCache.get(key);
  if (cached !== undefined) return cached;

  const parsed = parseScryptRecord(record);
  if (!parsed || parsed.hash.length !== SCRYPT_KEYLEN) {
    verifyCache.set(key, false);
    return false;
  }
  try {
    const derived = scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });
    const matches = timingSafeEqual(derived, parsed.hash);
    verifyCache.set(key, matches);
    return matches;
  } catch {
    verifyCache.set(key, false);
    return false;
  }
}

function configuredBindHostname(): string {
  return process.env.PI_WEB_HOSTNAME?.trim() || process.env.NITRO_HOST?.trim() || "127.0.0.1";
}

function configuredBindPort(): string {
  return process.env.NITRO_PORT?.trim() || process.env.PORT?.trim() || "30141";
}

function isUnspecifiedBindHost(hostname: string): boolean {
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

function firstLanIPv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family === 4 ? "IPv4" : entry.family;
      if (family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      return entry.address;
    }
  }
}

function authorityFromRequest(request?: Request): { hostname: string; port: string } | undefined {
  const host = request?.headers.get("host")?.trim();
  if (!host) return undefined;
  try {
    const url = new URL(`http://${host}`);
    if (!url.hostname || isUnspecifiedBindHost(url.hostname)) return undefined;
    return { hostname: url.hostname, port: url.port };
  } catch {
    return undefined;
  }
}

function advertiseBind(request?: Request): { bindHostname: string; bindPort: string } {
  const configuredHost = configuredBindHostname();
  const configuredPort = configuredBindPort();
  if (!isUnspecifiedBindHost(configuredHost)) {
    return { bindHostname: configuredHost, bindPort: configuredPort };
  }
  const fromRequest = authorityFromRequest(request);
  return {
    bindHostname: fromRequest?.hostname || firstLanIPv4() || "127.0.0.1",
    bindPort: fromRequest?.port || configuredPort,
  };
}

export function readRemoteAccessSnapshot(request?: Request): RemoteAccessSnapshot {
  const path = getRemoteAccessConfigPath();
  const cache = readFileCache(path);
  const envAllowedHosts = parseEnvAllowedHosts();
  const envPassword = envPasswordEnabled();
  const filePassword = cache.kind === "ok" && Boolean(cache.passwordHash);
  const passwordSource: RemoteAccessPasswordSource | undefined = envPassword
    ? "env"
    : filePassword
      ? "file"
      : undefined;
  return {
    schemaVersion: REMOTE_ACCESS_SCHEMA_VERSION,
    configPath: path,
    ...advertiseBind(request),
    allowedHosts: cache.kind === "ok" ? cache.allowedHosts : [],
    envAllowedHosts,
    passwordConfigured: Boolean(passwordSource),
    ...(passwordSource ? { passwordSource } : {}),
    username: PI_WEB_AUTH_USERNAME,
    ...(cache.kind === "invalid" ? { configError: cache.configError } : {}),
  };
}

function validatePassword(password: string): RemoteAccessWriteError | undefined {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: "password_invalid",
      error: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
    };
  }
  return undefined;
}

export function writeRemoteAccessConfig(input: {
  allowedHosts: unknown;
  password?: string | null;
  loopbackRequest: boolean;
  request?: Request;
}): RemoteAccessWriteResult {
  const hosts = normalizeHostList(input.allowedHosts);
  if (!Array.isArray(hosts)) {
    return { ok: false, status: 400, code: "invalid_hostname", error: hosts.error };
  }

  const path = getRemoteAccessConfigPath();
  const existing = readFileCache(path);
  const currentHash = existing.kind === "ok" ? existing.passwordHash : undefined;
  const extra = existing.kind === "ok"
    ? Object.fromEntries(
      Object.entries(existing.stored).filter(([key]) => (
        key !== "schemaVersion" && key !== "allowedHosts" && key !== "passwordHash"
      )),
    )
    : {};

  let nextHash = currentHash;
  if (input.password === null) {
    if (!input.loopbackRequest) {
      return {
        ok: false,
        status: 403,
        code: "cannot_disable_password_remotely",
        error: "Password can only be cleared from localhost",
      };
    }
    if (hosts.length > 0 && !envPasswordEnabled()) {
      return {
        ok: false,
        status: 400,
        code: "password_required",
        error: "A password is required while allowed hostnames are configured",
      };
    }
    nextHash = undefined;
  } else if (typeof input.password === "string") {
    const invalid = validatePassword(input.password);
    if (invalid) return invalid;
    nextHash = hashPassword(input.password);
  }

  const effectivePassword = envPasswordEnabled() || Boolean(nextHash);
  if (hosts.length > 0 && !effectivePassword) {
    return {
      ok: false,
      status: 400,
      code: "password_required",
      error: "A password is required while allowed hostnames are configured",
    };
  }

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const serialized: StoredFile = {
    schemaVersion: REMOTE_ACCESS_SCHEMA_VERSION,
    allowedHosts: hosts,
    ...extra,
  };
  if (nextHash) serialized.passwordHash = nextHash;
  writePrivateFileAtomicSync(path, `${JSON.stringify(serialized, null, 2)}\n`);
  invalidateRemoteAccessCache();
  return { ok: true, snapshot: readRemoteAccessSnapshot(input.request) };
}
