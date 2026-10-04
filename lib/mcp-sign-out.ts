import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpOAuthCredentialStore, McpOAuthServerStore, PiSdkInternals } from "./pi-sdk-internals";

// What a sign-out of an MCP server bars (ADR 0006, Settings › MCP sign-in):
// every connection Pi Web opened for the server before the sign-out, a
// sign-in's (`lib/mcp-sign-in.ts`) and a Test's (`lib/mcp-test.ts`), stores
// nothing in `mcp-auth.json` afterwards. A refresh already on its way when the
// tokens are removed would otherwise save renewed ones right after, and sign
// the server back in while the panel says signed out. `mcp-sign-in` imports
// `mcp-test`, so what both need lives here. The SDK keys a server's
// credentials by its name and URL (`mcpOAuthStoreKeys()`), so servers sharing
// a URL keep separate accounts, and so does everything here.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The URL a server signs in at, by the SDK's rule (`runtime.js` usesOAuth /
 * `oauthUrl`): an entry with a `url`, no `auth` (which sends a pi provider's
 * token instead) and no `Authorization` header, in any case. Undefined for a
 * stdio server and for one that authenticates otherwise.
 */
export function mcpOAuthUrl(config: McpServerConfig | Record<string, unknown>): string | undefined {
  if (!isRecord(config) || !("url" in config) || typeof config.url !== "string" || config.auth) return undefined;
  const headers = isRecord(config.headers) ? Object.keys(config.headers) : [];
  return headers.some((header) => header.toLowerCase() === "authorization") ? undefined : config.url;
}

/**
 * The keys `mcp-auth.json` stores a server's credentials under, as the SDK's
 * store (`oauth.js` storeKeys) spells them: `key` by the server's namespace
 * (`mcp__<name>`, `-` as `_`) and URL, and `legacyKey` by the URL alone, which
 * older versions wrote. The SDK reads `key`, else `legacyKey`; the first server
 * of the URL to load takes the legacy state over, and a sign-out removes
 * whichever the server would read. Throws for a URL that does not parse.
 */
export function mcpOAuthStoreKeys(name: string, url: string): { key: string; legacyKey: string } {
  const legacyKey = String(new URL(url));
  return { key: `mcp__${name.replace(/-/g, "_")}|${legacyKey}`, legacyKey };
}

/** The key a server's sign-ins, sign-outs and guards are counted under: its `mcp-auth.json` key. */
export function mcpSignInKey(name: string, url: string): string {
  return mcpOAuthStoreKeys(name, url).key;
}

/**
 * Called by a connection's store before every write to `mcp-auth.json`:
 * throws `McpSignedOutError` once the server was signed out after the
 * connection's run started.
 */
export type McpSignInWriteGuard = () => void;

/** What a guarded store throws when it would write after its URL was signed out. */
export class McpSignedOutError extends Error {
  constructor() {
    super("The server was signed out of while this connection was under way, so it stores nothing more");
    this.name = "McpSignedOutError";
  }
}

// Hot reload re-evaluates this module; globalThis keeps the counts. They lived
// in the sign-in registry before (`Symbol.for("pi-web:mcp-sign-in")`.signOuts),
// whose map a dev server may still hold: it is taken over, so a run started
// before the reload keeps comparing against the same count.
const SIGN_OUTS_KEY: symbol = Symbol.for("pi-web:mcp-sign-outs");
const LEGACY_REGISTRY_KEY: symbol = Symbol.for("pi-web:mcp-sign-in");

/** Sign-in key → how often it was signed out in this process. Never pruned: one number per server signed out of. */
function signOutCounts(): Map<string, number> {
  const store = globalThis as Record<symbol, unknown>;
  const legacy = store[LEGACY_REGISTRY_KEY] as { signOuts?: Map<string, number> } | undefined;
  return (store[SIGN_OUTS_KEY] ??= legacy?.signOuts ?? new Map<string, number>()) as Map<string, number>;
}

/** How often the sign-in key (`mcpSignInKey()`) was signed out in this process. */
export function mcpSignOutCount(key: string): number {
  return signOutCounts().get(key) ?? 0;
}

/** Counts a sign-out of the sign-in key: every guard made before it throws from now on. */
export function noteMcpSignOut(key: string): void {
  const counts = signOutCounts();
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** A guard for a run of server `name` at `url` starting now: it throws once the server is signed out after this call. */
export function mcpSignOutGuard(name: string, url: string): McpSignInWriteGuard {
  const key = mcpSignInKey(name, url);
  const atStart = mcpSignOutCount(key);
  return () => {
    if (mcpSignOutCount(key) !== atStart) throw new McpSignedOutError();
  };
}

/**
 * The SDK's credential store over the same `mcp-auth.json`, whose writes call
 * `guard` first: the store a connection reads and refreshes tokens through, so
 * a refresh that is still on its way when the server is signed out cannot
 * store the renewed tokens after they were removed. `guard` runs in the same
 * synchronous step as the SDK's write, so no removal fits between. A load that
 * takes over legacy state moves what is already stored and is not guarded.
 */
export function guardedCredentialStore(
  internals: Pick<PiSdkInternals, "McpOAuthCredentialStore">,
  guard: McpSignInWriteGuard,
): McpOAuthCredentialStore {
  class GuardedCredentialStore extends internals.McpOAuthCredentialStore {
    forServer(name: string, serverUrl: string): McpOAuthServerStore {
      const store = super.forServer(name, serverUrl);
      return {
        load: () => store.load(),
        save: (state) => {
          guard();
          return store.save(state);
        },
        withRefreshLock: (fn) => store.withRefreshLock(fn),
      };
    }
  }
  return new GuardedCredentialStore();
}
