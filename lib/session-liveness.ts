import type { DebugLivenessProvider } from "./debug-types";

const SESSION_LIVENESS_PROTOCOL_VERSION = 1;
export const SESSION_LIVENESS_REGISTRY_KEY = "@agegr/pi-web/session-liveness/v1";
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

/** A page's id, the label of its event streams (GET /api/agent/[id]/events?holder=). */
export function isValidLivenessHolder(value: unknown): value is string {
  return typeof value === "string" && LIVENESS_HOLDER_PATTERN.test(value);
}

function listExtensionProviders(): ListedLivenessProvider[] | null {
  return typeof registry.list === "function" ? registry.list() : null;
}

/**
 * The extensions' liveness providers, without asking any of them whether it is active: that
 * runs extension code. Null when the registry cannot list.
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
