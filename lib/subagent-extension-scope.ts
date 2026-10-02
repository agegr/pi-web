import {
  createAgentSessionServices,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { getProjectTrustStatus } from "./project-trust";
import { selectSubagentExtensionPaths, validateExtensionScope } from "./subagents";

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
type Resource = Awaited<ReturnType<DefaultPackageManager["resolve"]>>["extensions"][number];

/**
 * App-only compatibility adapter pinned to SDK 0.99.1. The native loader retains
 * the constructor's additionalExtensionPaths array by reference. Real reload
 * tests pin that behavior; this is not an SDK pre-import filtering API.
 */
export async function createScopedAgentSessionServices(
  options: Parameters<typeof createAgentSessionServices>[0],
  scope: readonly string[] | undefined,
) {
  if (scope === undefined) return createAgentSessionServices(options);
  const names = validateExtensionScope(scope);
  const cwd = resolve(options.cwd);
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const loaderOptions: Partial<LoaderOptions> = options.resourceLoaderOptions ?? {};
  if (loaderOptions.additionalExtensionPaths?.length) {
    throw new Error("Scoped extensions do not accept additionalExtensionPaths");
  }
  const suppressed = loaderOptions.noExtensions === true;
  const builtinExtensions = (loaderOptions.extensionFactories ?? []).flatMap((factory) =>
    typeof factory !== "function" && factory.builtin === true ? [factory.name] : []);
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager, builtinExtensions });
  const selectedPaths: string[] = [];
  let metadata = new Map<string, Resource["metadata"]>();

  const restore = (result: LoadExtensionsResult) => {
    for (const extension of result.extensions) {
      const original = metadata.get(extension.path);
      if (!original) continue; // Host inline factories are deliberately independent.
      extension.sourceInfo = {
        path: extension.path,
        source: original.source,
        scope: original.scope,
        origin: original.origin,
        ...(original.baseDir ? { baseDir: original.baseDir } : {}),
      };
      for (const tool of extension.tools.values()) tool.sourceInfo = extension.sourceInfo;
      for (const command of extension.commands.values()) command.sourceInfo = extension.sourceInfo;
    }
    return result;
  };
  const discover = async () => {
    // Clear before anything that can fail: a failed pass must never reload an old grant.
    selectedPaths.splice(0);
    metadata = new Map();
    settingsManager.setProjectTrusted(getProjectTrustStatus(cwd, agentDir).trusted);
    await settingsManager.reload();
    const errors = settingsManager.drainErrors();
    if (errors.length) throw new Error(`Scoped extension settings reload failed: ${errors.map((entry) => entry.error.message).join("; ")}`);
    const resources = (await packages.resolve()).extensions.filter((entry) => entry.enabled);
    const paths = suppressed ? [] : selectSubagentExtensionPaths(resources.map((entry) => ({
      path: entry.path, sourceInfo: entry.metadata, tools: new Map(),
    })), names);
    metadata = new Map(resources.filter((entry) => paths.includes(entry.path)).map((entry) => [entry.path, entry.metadata]));
    selectedPaths.push(...paths);
  };
  await discover();
  const services = await createAgentSessionServices({
    ...options,
    cwd,
    agentDir,
    settingsManager,
    // Consume inherited host trust options without executing the SDK pre-trust bootstrap.
    resourceLoaderReloadOptions: undefined,
    resourceLoaderOptions: {
      ...loaderOptions,
      noExtensions: true,
      additionalExtensionPaths: selectedPaths,
      extensionsOverride: (result) => loaderOptions.extensionsOverride?.(restore(result)) ?? restore(result),
    },
  });
  restore(services.resourceLoader.getExtensions()); // SDK assigns sourceInfo AFTER override.
  const nativeReload = services.resourceLoader.reload.bind(services.resourceLoader);
  let queue: Promise<void> = Promise.resolve();
  services.resourceLoader.reload = (reloadOptions) => {
    const pass = queue.then(async () => {
      if (reloadOptions?.resolveProjectTrust) {
        throw new Error("Scoped extension reload does not support resolveProjectTrust bootstrap");
      }
      await discover();
      await nativeReload(reloadOptions);
      restore(services.resourceLoader.getExtensions());
    });
    queue = pass.catch(() => {});
    return pass;
  };
  return services;
}
