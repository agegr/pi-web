import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpOAuthCredentialStore, McpOAuthServerStore, PiSdkInternals } from "./pi-sdk-internals";

// What a sign-out of an MCP server's URL bars (ADR 0006, Settings › MCP
// sign-in): every connection Pi Web opened for the URL before the sign-out,
// a sign-in's (`lib/mcp-sign-in.ts`) and a Test's (`lib/mcp-test.ts`), stores
// nothing in `mcp-auth.json` afterwards. A refresh already on its way when the
// tokens are removed would otherwise save renewed ones right after, and sign
// the URL back in while the panel says signed out. `mcp-sign-in` imports
// `mcp-test`, so what both need lives here.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The URL a server signs in at, by the SDK's rule (`runtime.js` usesOAuth /
 * `oauthUrl`): an entry with a `url` and no `Authorization` header, in any
 * case. Undefined for a stdio server and for one that sends its own header.
 */
export function mcpOAuthUrl(config: McpServerConfig | Record<string, unknown>): string | undefined {
  if (!isRecord(config) || !("url" in config) || typeof config.url !== "string") return undefined;
  const headers = isRecord(config.headers) ? Object.keys(config.headers) : [];
  return headers.some((header) => header.toLowerCase() === "authorization") ? undefined : config.url;
}

/** The key `mcp-auth.json` stores a server's credentials under, as the SDK's store spells it. */
export function mcpSignInUrlKey(url: string): string {
  return String(new URL(url));
}

/**
 * Called by a connection's store before every write to `mcp-auth.json`:
 * throws `McpSignedOutError` once the URL was signed out after the
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

/** URL key → how often it was signed out in this process. Never pruned: one number per URL signed out of. */
function signOutCounts(): Map<string, number> {
  const store = globalThis as Record<symbol, unknown>;
  const legacy = store[LEGACY_REGISTRY_KEY] as { signOuts?: Map<string, number> } | undefined;
  return (store[SIGN_OUTS_KEY] ??= legacy?.signOuts ?? new Map<string, number>()) as Map<string, number>;
}

/** How often the URL key (`mcpSignInUrlKey()`) was signed out in this process. */
export function mcpSignOutCount(key: string): number {
  return signOutCounts().get(key) ?? 0;
}

/** Counts a sign-out of the URL key: every guard made before it throws from now on. */
export function noteMcpSignOut(key: string): void {
  const counts = signOutCounts();
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** A guard for a run starting now on `url`: it throws once the URL is signed out after this call. */
export function mcpSignOutGuard(url: string): McpSignInWriteGuard {
  const key = mcpSignInUrlKey(url);
  const atStart = mcpSignOutCount(key);
  return () => {
    if (mcpSignOutCount(key) !== atStart) throw new McpSignedOutError();
  };
}

/**
 * The SDK's credential store over the same `mcp-auth.json`, whose writes call
 * `guard` first: the store a connection reads and refreshes tokens through, so
 * a refresh that is still on its way when the URL is signed out cannot store
 * the renewed tokens after they were removed. `guard` runs in the same
 * synchronous step as the SDK's write, so no removal fits between.
 */
export function guardedCredentialStore(
  internals: Pick<PiSdkInternals, "McpOAuthCredentialStore">,
  guard: McpSignInWriteGuard,
): McpOAuthCredentialStore {
  class GuardedCredentialStore extends internals.McpOAuthCredentialStore {
    forServer(serverUrl: string): McpOAuthServerStore {
      const store = super.forServer(serverUrl);
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
