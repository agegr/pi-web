import {
  createAgentSessionServices,
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type CreateAgentSessionServicesOptions,
} from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus } from "./project-trust";
import { extensionSelectorNames } from "./subagents";

/**
 * Scope discovery BEFORE extension import/factory execution. Do not use
 * extensionsOverride here: it runs after factories (and provider side effects).
 * Unscoped callers retain the SDK's ordinary loader/trust behavior.
 */
export async function createScopedAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
  extensionScope?: readonly string[],
) {
  if (extensionScope === undefined) return createAgentSessionServices(options);

  const { cwd } = options;
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const wanted = new Set(extensionScope.map((name) => name.toLowerCase()));
  // DefaultResourceLoader retains this public constructor option by reference.
  // Mutate our array, never SDK private fields; actual-loader regression tests
  // protect this contract across SDK upgrades.
  const additionalExtensionPaths: string[] = [];
  async function discover() {
    additionalExtensionPaths.splice(0);
    settingsManager.setProjectTrusted(getProjectTrustStatus(cwd, agentDir).trusted);
    await settingsManager.reload();
    if (options.resourceLoaderOptions?.noExtensions || wanted.size === 0) return;
    const resolved = await packages.resolve();
    additionalExtensionPaths.push(...resolved.extensions
      .filter((entry) => entry.enabled && [...extensionSelectorNames({ path: entry.path, sourceInfo: entry.metadata })]
        .some((name) => wanted.has(name)))
      .map((entry) => entry.path));
  }
  await discover();
  const services = await createAgentSessionServices({
    ...options,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      ...options.resourceLoaderOptions,
      noExtensions: true,
      additionalExtensionPaths,
    },
    // resolveProjectTrust bootstraps global extensions before asking for trust.
    // Trust was already set above, without executing any extension code.
    resourceLoaderReloadOptions: undefined,
  });
  const reload = services.resourceLoader.reload.bind(services.resourceLoader);
  let pending: Promise<void> = Promise.resolve();
  services.resourceLoader.reload = () => {
    const next = pending.then(async () => {
      await discover();
      await reload();
    });
    // Serialize discovery + import; a failed pass must not poison future reloads.
    pending = next.catch(() => {});
    return next;
  };
  return services;
}
