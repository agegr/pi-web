import type { DebugLease, DebugLivenessProvider } from "./debug-types";

const SESSION_LIVENESS_PROTOCOL_VERSION = 1;
export const SESSION_LIVENESS_REGISTRY_KEY = "@agegr/pi-web/session-liveness/v1";
export const SESSION_LIVENESS_LEASE_TTL_MS = 90_000;
const SESSION_LIVENESS_LEASES_KEY = "@agegr/pi-web/session-liveness-leases/v2";
/** The provider each page lease registers; the debug panel lists leases apart from extensions. */
export const SESSION_LEASE_PROVIDER_NAME = "pi-web-selected-session";
const LIVENESS_HOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface SessionLivenessProvider {
  name: string;
  sessionId: string;
  sessionFile?: string;
  isActive(): boolean;
}

interface SessionIdentity {
  sessionId: string;
  sessionFile?: string;
}

/** A registered provider as list() reports it; `isActive` calls the provider's own. */
interface ListedLivenessProvider {
  name: string;
  sessionId: string;
  sessionFile?: string;
  isActive(): boolean;
}

interface SessionLivenessRegistry {
  version: typeof SESSION_LIVENESS_PROTOCOL_VERSION;
  register(provider: SessionLivenessProvider): () => void;
  hasActiveProvider(session: SessionIdentity): boolean;
  /**
   * For pi-web's debug panel, not part of the extension contract. Optional: a registry made by
   * older code survives a hot reload on globalThis without it.
   */
  list?(): ListedLivenessProvider[];
}

interface LeaseRecord {
  expiresAt: number;
  released: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  release(): void;
  // Debug panel bookkeeping; optional because records made before a hot reload lack them.
  createdAt?: number;
  renewedAt?: number | null;
  renewals?: number;
}

// One lease per page and session, keyed `${holder}\n${sessionId}`.
type LeaseStore = Map<string, LeaseRecord>;

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Session liveness provider ${field} must be a non-empty string`);
  }
}

function validateProvider(provider: SessionLivenessProvider): void {
  if (!provider || typeof provider !== "object") {
    throw new Error("Session liveness provider must be an object");
  }
  assertNonEmptyString(provider.name, "name");
  assertNonEmptyString(provider.sessionId, "sessionId");
  if (provider.sessionFile !== undefined) {
    assertNonEmptyString(provider.sessionFile, "sessionFile");
  }
  if (typeof provider.isActive !== "function") {
    throw new Error("Session liveness provider isActive must be a function");
  }
}

function createRegistry(): SessionLivenessRegistry {
  const providers = new Map<symbol, SessionLivenessProvider>();

  return {
    version: SESSION_LIVENESS_PROTOCOL_VERSION,
    register(provider) {
      validateProvider(provider);
      const token = Symbol(provider.name);
      providers.set(token, provider);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        providers.delete(token);
      };
    },
    hasActiveProvider(session) {
      const identities = new Set([session.sessionId, session.sessionFile].filter((value): value is string => Boolean(value)));
      for (const provider of providers.values()) {
        if (!identities.has(provider.sessionId) && (!provider.sessionFile || !identities.has(provider.sessionFile))) {
          continue;
        }
        try {
          const active = provider.isActive();
          if (typeof active !== "boolean") {
            throw new Error("isActive() must return a boolean");
          }
          if (active) return true;
        } catch (error) {
          console.error(`[pi-web] Session liveness provider '${provider.name}' failed; preserving the session:`, error);
          return true;
        }
      }
      return false;
    },
    list() {
      return Array.from(providers.values(), (provider) => ({
        name: provider.name,
        sessionId: provider.sessionId,
        ...(provider.sessionFile !== undefined ? { sessionFile: provider.sessionFile } : {}),
        isActive: () => provider.isActive(),
      }));
    },
  };
}

function isCompatibleRegistry(value: unknown): value is SessionLivenessRegistry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionLivenessRegistry>;
  return candidate.version === SESSION_LIVENESS_PROTOCOL_VERSION
    && typeof candidate.register === "function"
    && typeof candidate.hasActiveProvider === "function";
}

function getRegistry(): SessionLivenessRegistry {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(SESSION_LIVENESS_REGISTRY_KEY);
  const existing = store[key];
  if (isCompatibleRegistry(existing)) return existing;
  const registry = createRegistry();
  store[key] = registry;
  return registry;
}

const registry = getRegistry();

function getLeaseStore(): LeaseStore {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(SESSION_LIVENESS_LEASES_KEY);
  const existing = store[key];
  if (existing instanceof Map) return existing as LeaseStore;
  const leases: LeaseStore = new Map();
  store[key] = leases;
  return leases;
}

function readLeaseStore(): LeaseStore | null {
  const existing = (globalThis as Record<PropertyKey, unknown>)[Symbol.for(SESSION_LIVENESS_LEASES_KEY)];
  return existing instanceof Map ? existing as LeaseStore : null;
}

function scheduleLeaseExpiry(lease: LeaseRecord): void {
  if (lease.timer) clearTimeout(lease.timer);
  lease.timer = setTimeout(() => {
    if (!lease.released && lease.expiresAt <= Date.now()) lease.release();
    else if (!lease.released) scheduleLeaseExpiry(lease);
  }, Math.max(1, lease.expiresAt - Date.now()));
  const unref = (lease.timer as unknown as { unref?: () => void }).unref;
  unref?.call(lease.timer);
}

/**
 * Keep a session alive while a page has it selected: one lease per page (`holder`, an id the
 * page makes up) and session, created or renewed by each call (POST /api/agent/[id]/lease) and
 * released a TTL after the page's last call. It does not depend on the page's event stream, which
 * a page hidden for a while lets go of (#1283).
 */
export function holdSessionLivenessLease(sessionId: string, holder: string): void {
  const leases = getLeaseStore();
  const key = `${holder}\n${sessionId}`;
  const existing = leases.get(key);
  if (existing && !existing.released && existing.expiresAt > Date.now()) {
    existing.expiresAt = Date.now() + SESSION_LIVENESS_LEASE_TTL_MS;
    existing.renewedAt = Date.now();
    existing.renewals = (existing.renewals ?? 0) + 1;
    scheduleLeaseExpiry(existing);
    return;
  }
  existing?.release();
  const providerRelease = registerSessionLivenessProvider({
    name: SESSION_LEASE_PROVIDER_NAME,
    sessionId,
    isActive: () => !lease.released && lease.expiresAt > Date.now(),
  });
  const lease: LeaseRecord = {
    expiresAt: Date.now() + SESSION_LIVENESS_LEASE_TTL_MS,
    released: false,
    timer: null,
    release: () => {
      if (lease.released) return;
      lease.released = true;
      if (lease.timer) clearTimeout(lease.timer);
      providerRelease();
      if (leases.get(key) === lease) leases.delete(key);
    },
    createdAt: Date.now(),
    renewedAt: null,
    renewals: 0,
  };
  leases.set(key, lease);
  scheduleLeaseExpiry(lease);
}

/** A page's lease holder id (POST /api/agent/[id]/lease?holder=), also the label of its event streams. */
export function isValidLivenessHolder(value: unknown): value is string {
  return typeof value === "string" && LIVENESS_HOLDER_PATTERN.test(value);
}

/**
 * Every page lease, for the debug panel. A record lingers between its expiry and its unref'd
 * timer, so `active` is computed here; nothing is released, renewed or rescheduled.
 */
export function listSessionLivenessLeases(now = Date.now()): (DebugLease & { sessionId: string })[] {
  const leases = readLeaseStore();
  if (!leases) return [];
  const listed: (DebugLease & { sessionId: string })[] = [];
  for (const [key, lease] of leases) {
    // The holder never holds a newline; a session id might.
    const split = key.indexOf("\n");
    if (split < 0 || typeof lease?.expiresAt !== "number") continue;
    listed.push({
      sessionId: key.slice(split + 1),
      holder: key.slice(0, split),
      expiresAt: lease.expiresAt,
      active: !lease.released && lease.expiresAt > now,
      createdAt: typeof lease.createdAt === "number" ? lease.createdAt : null,
      renewedAt: typeof lease.renewedAt === "number" ? lease.renewedAt : null,
      renewals: typeof lease.renewals === "number" ? lease.renewals : null,
    });
  }
  return listed;
}

function listExtensionProviders(): ListedLivenessProvider[] | null {
  if (typeof registry.list !== "function") return null;
  return registry.list().filter((provider) => provider.name !== SESSION_LEASE_PROVIDER_NAME);
}

/**
 * The extensions' liveness providers (pi-web's own leases left out), without asking any of them
 * whether it is active: that runs extension code. Null when the registry cannot list.
 */
export function listRegisteredSessionLivenessProviders(): { name: string; sessionId: string; sessionFile: string | null }[] | null {
  return listExtensionProviders()?.map((provider) => ({
    name: provider.name,
    sessionId: provider.sessionId,
    sessionFile: provider.sessionFile ?? null,
  })) ?? null;
}

/**
 * The extensions' providers for one session, matched as the idle timer matches them, each asked
 * whether it is active. A throw or a non-boolean reads "error" and is not logged: the idle
 * timer's own check reports it when it matters. Null when the registry cannot list.
 */
export function listSessionLivenessProviders(
  session: SessionIdentity,
): (DebugLivenessProvider & { sessionId: string; sessionFile: string | null })[] | null {
  const providers = listExtensionProviders();
  if (!providers) return null;
  const identities = new Set([session.sessionId, session.sessionFile].filter((value): value is string => Boolean(value)));
  return providers
    .filter((provider) => identities.has(provider.sessionId) || (provider.sessionFile !== undefined && identities.has(provider.sessionFile)))
    .map((provider) => {
      let active: boolean | "error";
      try {
        const answer = provider.isActive();
        active = typeof answer === "boolean" ? answer : "error";
      } catch {
        active = "error";
      }
      return {
        name: provider.name,
        sessionId: provider.sessionId,
        sessionFile: provider.sessionFile ?? null,
        active,
        byFile: !identities.has(provider.sessionId),
      };
    });
}

/**
 * Register session-scoped work that must survive pi-web's automatic idle eviction.
 * Explicit shutdown and runtime replacement still take precedence.
 */
export function registerSessionLivenessProvider(provider: SessionLivenessProvider): () => void {
  return registry.register(provider);
}

export function hasActiveSessionLivenessProvider(session: SessionIdentity): boolean {
  return registry.hasActiveProvider(session);
}
