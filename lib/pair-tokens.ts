import { randomBytes } from "node:crypto";

/**
 * Single-use pairing tokens. The desktop's "Connect Phone" modal embeds a
 * token in the QR code; when the phone scans, it hits `/?pair=<token>`,
 * proxy.ts validates the token, attaches the 30-day session cookie, and
 * redirects to `/`. The phone never has to type a password.
 *
 * Storage: a small JSON file in the project directory. We persist (rather
 * than keep tokens in memory) because:
 *   - The proxy and the route handlers may run in different module graphs
 *     (Next.js 16 isolates proxy from /api routes), and a token created
 *     by one is consumed by the other.
 *   - On a single-machine dev run the file is harmless; on multi-instance
 *     setups (production with multiple replicas) sharing the file is the
 *     simplest cross-process bridge we have.
 *
 * Lifetime: 5 minutes. Single use. Single hostname-bound (the QR encodes
 * the addressable host, not the bind address — see bin/pi-web.js).
 */

const FILE_NAME = ".pi-web-pair-tokens.json";
const TTL_MS = 5 * 60 * 1000;

interface PairToken {
  token: string;
  createdAt: number;
  /** True once the token has been exchanged for a session cookie. */
  used: boolean;
}

interface PairTokenStore {
  tokens: PairToken[];
}

function filePath(): string {
  // Lazy import keeps Node-only deps out of any module that bundles into
  // the client (none today, but belt-and-braces).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  return join(process.cwd(), FILE_NAME);
}

function readStore(): PairTokenStore {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const path = filePath();
    if (!existsSync(path)) return { tokens: [] };
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as PairTokenStore;
    if (!parsed || !Array.isArray(parsed.tokens)) return { tokens: [] };
    return parsed;
  } catch {
    return { tokens: [] };
  }
}

function writeStore(store: PairTokenStore): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(filePath(), JSON.stringify(store), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    /* swallow — caller will see stale state, which is fine: the token
       simply won't be redeemable */
  }
}

function purgeExpired(store: PairTokenStore): PairTokenStore {
  const cutoff = Date.now() - TTL_MS;
  return { tokens: store.tokens.filter((t) => t.createdAt > cutoff) };
}

/** Generate a new pair token. Replaces any previous unused tokens for this host. */
export function createPairToken(): { token: string; expiresAt: number } {
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const store = purgeExpired({ tokens: [{ token, createdAt: now, used: false }] });
  writeStore(store);
  return { token, expiresAt: now + TTL_MS };
}

/**
 * Atomically consume a pair token. Returns true iff:
 *   - the token exists in the store
 *   - it has not been used
 *   - it has not expired
 *
 * On success the token is marked used so a second scan with the same QR
 * is rejected.
 */
export function consumePairToken(token: string): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const store = purgeExpired(readStore());
  const entry = store.tokens.find((t) => t.token === token);
  if (!entry) return false;
  if (entry.used) return false;
  entry.used = true;
  writeStore(store);
  return true;
}