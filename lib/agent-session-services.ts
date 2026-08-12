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
      // creating a session, so session_shutdown cannot release pi-chrome's
      // process singleton. Restore the pre-discovery state so the real session
      // can register /chrome and chrome_* tools normally.
      if (hadPiChromeSingleton) {
        globalState[PI_CHROME_SINGLETON_KEY] = previousPiChromeSingleton;
      } else {
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
