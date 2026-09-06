import {
  createAgentSessionServices as createSdkAgentSessionServices,
  type AgentSessionServices,
  type CreateAgentSessionServicesOptions,
} from "@earendil-works/pi-coding-agent";

const PI_CHROME_SINGLETON_KEY = "__piChromeProfileBridgeLoaded__";

type ServiceLoadState = {
  tail: Promise<void>;
};

const globalState = globalThis as typeof globalThis & {
  __piWebAgentServiceLoads?: ServiceLoadState;
  [PI_CHROME_SINGLETON_KEY]?: unknown;
};

const serviceLoadState = globalState.__piWebAgentServiceLoads ??= {
  tail: Promise.resolve(),
};

async function serializeServiceLoad<T>(load: () => Promise<T>): Promise<T> {
  const previous = serviceLoadState.tail;
  let release!: () => void;
  serviceLoadState.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await load();
  } finally {
    release();
  }
}

export async function runAgentServiceLoad<T>(
  load: () => Promise<T>,
  options: { transientExtensions?: boolean } = {},
): Promise<T> {
  return serializeServiceLoad(async () => {
    if (!options.transientExtensions) return load();

    const hadPiChromeSingleton = Object.prototype.hasOwnProperty.call(globalState, PI_CHROME_SINGLETON_KEY);
    const previousPiChromeSingleton = globalState[PI_CHROME_SINGLETON_KEY];
    try {
      return await load();
    } finally {
      // Service-only model discovery evaluates extension factories without ever
      // creating a session, so it cannot emit session_shutdown for a singleton
      // it acquired. Keep an unchanged active-session singleton, but never
      // restore its snapshot: that session may have shut down while discovery
      // was in flight. Any other value can only belong to this serialized,
      // transient load and must be released for the next real session.
      const existingSessionStillOwnsSingleton =
        hadPiChromeSingleton
        && Object.prototype.hasOwnProperty.call(globalState, PI_CHROME_SINGLETON_KEY)
        && globalState[PI_CHROME_SINGLETON_KEY] === previousPiChromeSingleton;
      if (!existingSessionStillOwnsSingleton) {
        delete globalState[PI_CHROME_SINGLETON_KEY];
      }
    }
  });
}

export function createPiWebAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
  lifecycle: { transientExtensions?: boolean } = {},
): Promise<AgentSessionServices> {
  return runAgentServiceLoad(
    () => createSdkAgentSessionServices(options),
    lifecycle,
  );
}
