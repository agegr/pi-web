import { isAbsolute } from "node:path";
import { ModelRuntime, type AgentSession, type LoadExtensionsResult, type SessionManager } from "@earendil-works/pi-coding-agent";

type Sources = Map<string, Set<string>>;
const queuedSources = new WeakMap<LoadExtensionsResult["runtime"], Sources>();
const runtimeSources = new WeakMap<ModelRuntime, Sources>();
const tracked = new WeakSet<LoadExtensionsResult["runtime"]>();

function remember(sources: Sources, provider: string, path?: string): void {
  if (!path || !isAbsolute(path)) return;
  const paths = sources.get(provider) ?? new Set<string>();
  paths.add(path);
  sources.set(provider, paths);
}

/** Keep registration provenance before the SDK consumes its pending queues. */
export function captureProviderExtensions(result: LoadExtensionsResult): LoadExtensionsResult {
  const sources: Sources = new Map();
  for (const item of result.runtime.pendingProviderRegistrations) remember(sources, item.name, item.extensionPath);
  for (const item of result.runtime.pendingNativeProviderRegistrations) remember(sources, item.provider.id, item.extensionPath);
  queuedSources.set(result.runtime, sources);
  return result;
}

/** session_start registrations carry their owning extension path through the SDK. */
export function trackProviderExtensions(session: Pick<AgentSession, "modelRuntime" | "resourceLoader">): void {
  const extensionRuntime = session.resourceLoader.getExtensions().runtime;
  const sources = runtimeSources.get(session.modelRuntime) ?? new Map<string, Set<string>>();
  runtimeSources.set(session.modelRuntime, sources);
  for (const [id, paths] of queuedSources.get(extensionRuntime) ?? []) {
    for (const path of paths) remember(sources, id, path);
  }
  if (tracked.has(extensionRuntime)) return;
  tracked.add(extensionRuntime);
  const registerProvider = extensionRuntime.registerProvider;
  const registerNativeProvider = extensionRuntime.registerNativeProvider;
  extensionRuntime.registerProvider = (id, config, path) => {
    remember(sources, id, path);
    registerProvider(id, config, path);
  };
  extensionRuntime.registerNativeProvider = (provider, path) => {
    remember(sources, provider.id, path);
    registerNativeProvider(provider, path);
  };
}

export function requiredProviderExtensions(session: Pick<AgentSession, "modelRuntime" | "resourceLoader">): string[] {
  const loaded = new Set(session.resourceLoader.getExtensions().extensions.map((extension) => extension.path));
  const sources = runtimeSources.get(session.modelRuntime);
  return [...new Set(session.modelRuntime.getRegisteredProviderIds().flatMap((id) =>
    [...(sources?.get(id) ?? [])].filter((path) => loaded.has(path)),
  ))];
}

/** Share request-auth resolution and definitions, with a separate mutable provider registry. */
export async function createSubagentModelRuntime(parent: ModelRuntime): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  runtime.getAuth = parent.getAuth.bind(parent);
  runtime.checkAuth = parent.checkAuth.bind(parent);
  runtime.isUsingOAuth = parent.isUsingOAuth.bind(parent);
  runtime.isUsingSubscription = parent.isUsingSubscription.bind(parent);
  runtime.getProviderAuthStatus = parent.getProviderAuthStatus.bind(parent);
  for (const id of parent.getRegisteredProviderIds()) {
    const native = parent.getRegisteredNativeProvider(id);
    if (native) runtime.registerNativeProvider(native);
    else {
      const config = parent.getRegisteredProviderConfig(id);
      if (config) runtime.registerProvider(id, config);
    }
  }
  return runtime;
}

/** Copy session-setting entries; response history and remote continuation IDs stay separate. */
export function inheritSubagentSettings(parent: SessionManager, child: SessionManager): void {
  const parentId = parent.getSessionId();
  const childId = child.getSessionId();
  const ownTypes = new Set(child.getEntries().filter((entry) => entry.type === "custom"
    && typeof entry.data === "object" && entry.data !== null && "sessionId" in entry.data && entry.data.sessionId === childId)
    .map((entry) => entry.type === "custom" ? entry.customType : ""));
  for (const entry of parent.getEntries()) {
    if (entry.type !== "custom" || !entry.customType.endsWith(":settings") || ownTypes.has(entry.customType)) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null || !("sessionId" in data) || data.sessionId !== parentId) continue;
    child.appendCustomEntry(entry.customType, { ...structuredClone(data), sessionId: childId });
  }
}
