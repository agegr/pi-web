import {
  createAgentSessionServices,
  getAgentDir,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { rememberProviderModels } from "./deferred-provider-models";
import { serializeByKey } from "./key-serializer";
import { llamaCppExtension } from "./pi-sdk-internals";

/**
 * ModelRuntime that also includes providers registered by extensions (an
 * extension that calls `registerProvider` / `createProvider` during resource
 * loading). A bare `ModelRuntime.create()` only knows built-in providers plus
 * models.json, so extension-registered providers were invisible to the
 * provider-listing and auth routes.
 *
 * The agent dir acts as cwd so project-local extensions stay out; global
 * package extensions always load. Every call runs every extension factory, so
 * routes that only read the runtime use `getModelRuntimeWithExtensions()`.
 * The OAuth login stream and the catalog refresh build their own: `login()`
 * and a network `refresh()` change the runtime they run on, for seconds.
 */
export async function createModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  const services = await createAgentSessionServices({
    cwd: agentDir,
    agentDir,
    resourceLoaderOptions: { extensionFactories: [llamaCppExtension] },
  });
  await rememberProviderModels(services.modelRuntime);
  return services.modelRuntime;
}

/**
 * The options pi's TUI passes to `ModelRuntime.login()`. Sign in with ChatGPT
 * (the `openai` provider's OAuth) refuses to start without this installation's
 * device ID; pi creates it on first use and keeps it as `deviceId` in the
 * global settings.json, so the TUI and Pi Web sign in as the same host.
 * `flush()` waits for that first write.
 */
export function createLoginOptions(agentDir = getAgentDir()) {
  const settingsManager = SettingsManager.create(agentDir, agentDir);
  return {
    options: { getDeviceId: () => settingsManager.getOrCreateDeviceId() },
    flush: () => settingsManager.flush(),
  };
}

interface SharedModelRuntime {
  agentDir: string;
  runtime: Promise<ModelRuntime>;
  /** This entry's refresh queue, so a refresh stuck in an extension holds no later entry. */
  queueKey: string;
  /** Infinity while the runtime is being built, so every caller joins that build. */
  expiresAt: number;
}

declare global {
  var __piWebSharedModelRuntime: SharedModelRuntime | undefined;
}

// Pi Web's own plugin changes and reloads invalidate the entry, so the TTL is
// only a backstop for changes made outside Pi Web: `pi install` from a
// terminal, an edited extension file. A build blocks the event loop while it
// imports (13 s with 11 extensions, #1465), so this stays rare; `/reload` applies
// such a change at once.
const SHARED_MODEL_RUNTIME_TTL_MS = 60 * 60_000;
const REFRESH_QUEUE_KEY: symbol = Symbol.for("pi-web:shared-model-runtime-refresh");

/**
 * One extension-loaded runtime per agent dir, shared by the routes that only
 * read it: the provider lists, the Models switches, the logout and API-key
 * provider lookups and MCP Test's provider token (#1226).
 *
 * Building one runs every extension, and the SDK keeps its extension factory
 * cache for one cwd only, so a build at the agent dir after a session's build
 * at its project re-imports every extension and blocks the event loop while
 * it does. Only the extension registrations are reused: each call refreshes
 * the runtime offline, which reads models.json, auth.json and
 * models-store.json again, so auth status is as fresh as a new runtime's.
 * Extensions changed outside Pi Web show once the entry expires; Pi Web's own
 * plugin changes and reloads call `invalidateModelRuntimeWithExtensions()`.
 */
export async function getModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  let entry = globalThis.__piWebSharedModelRuntime;
  if (!entry || entry.agentDir !== agentDir || entry.expiresAt <= Date.now()) {
    entry = buildSharedModelRuntime(agentDir);
    globalThis.__piWebSharedModelRuntime = entry;
  }
  // Awaited outside the queue: a build stuck in an extension factory (the SDK
  // awaits each one with no timeout) would otherwise hold every later call,
  // even after invalidation.
  const shared = await entry.runtime;
  // One refresh at a time, each started after its caller asked. When two
  // overlap, the SDK keeps only the later availability pass, and the earlier
  // caller returned the auth status from before both: a key saved a moment
  // ago still read as missing.
  return serializeByKey(REFRESH_QUEUE_KEY, entry.queueKey, async () => {
    await shared.refresh({ allowNetwork: false });
    await rememberProviderModels(shared);
    return shared;
  });
}

function buildSharedModelRuntime(agentDir: string): SharedModelRuntime {
  const entry: SharedModelRuntime = {
    agentDir,
    runtime: createModelRuntimeWithExtensions(),
    // A refresh runs extension providers' refreshModels(), which the SDK awaits
    // with no timeout: one stuck there blocks only this entry's queue, and the
    // entry after an invalidation starts its own.
    queueKey: `${agentDir}\0${randomUUID()}`,
    expiresAt: Number.POSITIVE_INFINITY,
  };
  entry.runtime.then(
    () => {
      entry.expiresAt = Date.now() + SHARED_MODEL_RUNTIME_TTL_MS;
    },
    () => {
      // A failed build is not kept: the next caller tries again.
      if (globalThis.__piWebSharedModelRuntime === entry) globalThis.__piWebSharedModelRuntime = undefined;
    },
  );
  return entry;
}

/** Build the shared runtime again on its next use, after the extension set may have changed. */
export function invalidateModelRuntimeWithExtensions(): void {
  globalThis.__piWebSharedModelRuntime = undefined;
}
