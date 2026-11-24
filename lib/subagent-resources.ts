import { join } from "node:path";
import {
  createAgentSessionServices,
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
  type AgentSessionServices,
  type CreateAgentSessionServicesOptions,
  type LoadExtensionsResult,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { scopeSubagentExtensions, subagentExtensionLoaderOptions } from "./subagents";

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
type ExtensionResources = Parameters<typeof subagentExtensionLoaderOptions>[0];
type Source = Skill["sourceInfo"];

function packageKey(info: Source): string | undefined {
  return info?.origin === "package" ? JSON.stringify([info.scope, info.source]) : undefined;
}

/** Project SDK discovery only after it has assigned sourceInfo, without a second resolution. */
class ScopedSubagentLoader extends DefaultResourceLoader {
  private scopedExtensions!: LoadExtensionsResult;
  private droppedPackages = new Set<string>();
  private readonly scopeExtensions;
  private readonly projectSkills;

  constructor({ skillsOverride, ...options }: LoaderOptions, names: readonly string[]) {
    super(options);
    this.scopeExtensions = scopeSubagentExtensions(names);
    this.projectSkills = skillsOverride;
  }

  override async reload(options?: CreateAgentSessionServicesOptions["resourceLoaderReloadOptions"]): Promise<void> {
    // The SDK owns the trust bootstrap, settings reload and any package installs. On session
    // reload this also runs after the old extensions' awaited session_shutdown hooks.
    await super.reload(options);
    const base = super.getExtensions();
    this.droppedPackages = new Set(base.extensions.flatMap(({ sourceInfo }) => packageKey(sourceInfo) ?? []));
    this.scopedExtensions = this.scopeExtensions(base);
    for (const { sourceInfo } of this.scopedExtensions.extensions) {
      const key = packageKey(sourceInfo);
      if (key) this.droppedPackages.delete(key);
    }
  }

  override getExtensions() {
    return this.scopedExtensions;
  }

  override getSkills() {
    const base = super.getSkills();
    const scoped = {
      ...base,
      skills: base.skills.filter(({ sourceInfo }) => {
        const key = packageKey(sourceInfo);
        return !key || !this.droppedPackages.has(key);
      }),
    };
    return this.projectSkills?.(scoped) ?? scoped;
  }
}

/** Build the scoped loader before exposing any extension provider to model selection. */
export async function createSubagentSessionServices(
  options: Omit<CreateAgentSessionServicesOptions, "extensionFlagValues"> & { agentDir: string },
  resources?: ExtensionResources,
): Promise<AgentSessionServices> {
  const extensionOptions = resources ? subagentExtensionLoaderOptions(resources) : undefined;
  const scopedNames = resources?.loadExtensions ? resources.extensions : undefined;
  if (scopedNames === undefined) {
    return createAgentSessionServices({
      ...options,
      resourceLoaderOptions: { ...extensionOptions, ...options.resourceLoaderOptions },
    });
  }
  const { cwd, agentDir } = options;
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    signal: options.modelRuntimeSignal,
  });
  const resourceLoader = new ScopedSubagentLoader({
    noExtensions: extensionOptions?.noExtensions,
    additionalExtensionPaths: extensionOptions?.additionalExtensionPaths,
    ...options.resourceLoaderOptions,
    cwd,
    agentDir,
    settingsManager,
  }, scopedNames);
  await resourceLoader.reload(options.resourceLoaderReloadOptions);

  // Match the SDK's service initialization, but only for the projected extension set.
  const diagnostics: AgentSessionServices["diagnostics"] = [];
  const register = (path: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      diagnostics.push({ type: "error", message: `Extension "${path}" error: ${error instanceof Error ? error.message : String(error)}` });
    }
  };
  const { runtime } = resourceLoader.getExtensions();
  for (const { name, config, extensionPath } of runtime.pendingProviderRegistrations) {
    register(extensionPath, () => { modelRuntime.registerProvider(name, config); });
  }
  for (const { provider, extensionPath } of runtime.pendingNativeProviderRegistrations) {
    register(extensionPath, () => { modelRuntime.registerNativeProvider(provider); });
  }
  for (const { definition, extensionPath } of runtime.pendingVirtualModelRegistrations) {
    register(extensionPath, () => { modelRuntime.registerVirtualModel(definition); });
  }
  runtime.pendingProviderRegistrations = [];
  runtime.pendingNativeProviderRegistrations = [];
  runtime.pendingVirtualModelRegistrations = [];
  await modelRuntime.refresh({ allowNetwork: false });
  return { cwd, agentDir, settingsManager, modelRuntime, resourceLoader, diagnostics };
}
