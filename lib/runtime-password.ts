import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runtime-only password holder, shared across Next.js's proxy worker and
 * the `/api/*` route workers via a small file in the project directory.
 *
 * Why a file (and not globalThis): Next.js 16 runs the proxy middleware
 * in a *separate worker process* from the route handlers. `globalThis` is
 * not shared across processes. The smallest cross-process bridge is a
 * file. The file:
 *   - is created lazily on first use
 *   - lives in `process.cwd()/.pi-web-runtime-password`
 *   - is in `.gitignore` so it never leaks into source control
 *   - has mode 0o600 so only the current user can read it
 *   - is wiped on `bin/pi-web.js` cold boot (invalidates prior cookies)
 *
 * Format: 6 decimal digits. Short enough to type on a phone in under 5
 * seconds; impossible to brute-force at the network level because the
 * server is reached via Tailscale, which is itself authenticated.
 */

const FILE_NAME = ".pi-web-runtime-password";
const FILE_MODE = 0o600;

interface Cache {
  password: string | null;
}

const CACHE_KEY = "__piWebRuntimePassword";
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Cache };

function getCache(): Cache {
  const g = globalThis as GlobalWithCache;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = { password: null };
  return g[CACHE_KEY] as Cache;
}

function filePath(): string {
  return join(process.cwd(), FILE_NAME);
}

function readPasswordFromFile(): string | null {
  try {
    const value = readFileSync(filePath(), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePasswordToFile(password: string): void {
  const target = filePath();
  const tempPath = join(process.cwd(), `.${FILE_NAME}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tempPath, password, {
      encoding: "utf8",
      mode: FILE_MODE,
      flag: "wx",
    });
    renameSync(tempPath, target);
  } catch (error) {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
    throw error;
  }
}

function generatePassword(): string {
  let value = "";
  for (let i = 0; i < 6; i += 1) {
    value += randomInt(0, 10).toString();
  }
  return value;
}

function readEnvPassword(): string | null {
  const value = process.env.PI_WEB_PASSWORD?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Returns the active password. Order: env var → existing on-disk file →
 * freshly generated (and persisted).
 *
 * Note: NO in-process cache. Next.js 16 may compile proxy.ts and route
 * files into separate module graphs that don't share globalThis; a
 * cached password would diverge between them and Basic Auth would silently
 * fail. The file is the only cross-process source of truth. A 6-byte read
 * from local disk is cheap enough that we just always read.
 */
export function getActivePassword(): string {
  if (readEnvPassword()) return readEnvPassword() as string;

  const existing = readPasswordFromFile();
  if (existing) return existing;

  // Lost the file (deleted by the launcher on cold start, no auth check
  // yet ran to regenerate). Generate, persist, return.
  const fresh = generatePassword();
  try {
    writePasswordToFile(fresh);
    return fresh;
  } catch (error) {
    // Another worker beat us to it; read what they wrote.
    const raced = readPasswordFromFile();
    if (raced) return raced;
    throw error;
  }
}

/** Regenerate. Returns the new password. No-op if PI_WEB_PASSWORD is set. */
export function regeneratePassword(): string {
  if (readEnvPassword()) return readEnvPassword() as string;
  const fresh = generatePassword();
  try {
    writePasswordToFile(fresh);
  } catch {
    try { unlinkSync(filePath()); } catch { /* ignore */ }
    try { writePasswordToFile(fresh); } catch { /* ignore */ }
  }
  return fresh;
}

/** True iff the active password is the env var (not regeneratable). */
export function isPasswordFromEnv(): boolean {
  return readEnvPassword() !== null;
}

/** True if a runtime password file is present in cwd. Used by /api/pair-info
 * to set `authRequired` without leaking the value. */
export function hasRuntimePasswordFile(): boolean {
  return existsSync(filePath());
}

/** Remove the runtime password file. Used by the launcher on cold boot. */
export function clearRuntimePasswordFile(): void {
  try {
    unlinkSync(filePath());
  } catch {
    /* ignore — file may not exist */
  }
}