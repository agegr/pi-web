import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DefaultPackageManager, formatSkillsForPrompt, type DefaultResourceLoader, type InlineExtension, type PathMetadata, type SettingsManager, type Skill } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./frontmatter";
import { subagentExtensionLoaderOptions, subagentNameList } from "./subagents";

/** The SDK supplies package metadata only after the two resource overrides have run. */
export function createSubagentPackageScope(
  resources: Parameters<typeof subagentExtensionLoaderOptions>[0],
  location: { cwd: string; agentDir: string; settingsManager: SettingsManager },
) {
  const scoped = resources.loadExtensions && resources.extensions !== undefined;
  const metadata = new Map<string, PathMetadata>();
  const pathKey = (path: string) => {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  const packageForPath = (path: string) => {
    const info = metadata.get(pathKey(path));
    if (info?.origin !== "package") return undefined;
    return { key: info.packageRoot ? pathKey(info.packageRoot) : `${info.scope}:${info.source}`, source: info.source };
  };
  const { extensionsOverride, ...options } = subagentExtensionLoaderOptions(resources, packageForPath);
  if (!scoped || !extensionsOverride) return { loaderOptions: options };

  let droppedPackages = new Set<string>();
  return {
    // Ask the public package resolver for the same path provenance the loader will use.
    // This scans resources without importing factories or inferring ownership from filenames.
    prepare: async () => {
      await location.settingsManager.reload();
      metadata.clear();
      if (location.settingsManager.getPackages().length === 0) return;
      const { extensions, skills } = await new DefaultPackageManager(location).resolve();
      for (const { path, metadata: info } of [...extensions, ...skills]) {
        if (!metadata.has(pathKey(path))) metadata.set(pathKey(path), info);
      }
      for (const { path, metadata: info } of skills) {
        // SDK discovery can turn a package skill directory into its SKILL.md.
        const file = pathKey(join(path, "SKILL.md"));
        if (!metadata.has(file)) metadata.set(file, info);
      }
    },
    loaderOptions: {
      ...options,
      extensionsOverride: (base: Parameters<typeof extensionsOverride>[0]) => {
        const packageKeys = (extensions: typeof base.extensions) => extensions.flatMap(({ path }) => {
          const pkg = packageForPath(path);
          return pkg ? [pkg.key] : [];
        });
        droppedPackages = new Set(packageKeys(base.extensions));
        const result = extensionsOverride(base);
        for (const key of packageKeys(result.extensions)) droppedPackages.delete(key);
        return result;
      },
    },
    filterSkills: (skills: Skill[]) => droppedPackages.size === 0 ? skills : skills.filter(({ filePath }) => {
      const pkg = packageForPath(filePath);
      return !pkg || !droppedPackages.has(pkg.key);
    }),
  };
}

/** One discovery binding and one prompt projection, shared by spawn and reopen. */
export function createSubagentSkillsBinding(options: {
  loadSkills: boolean;
  skills?: readonly string[];
  exactSystemPrompt?: string;
  filterSkills?: (skills: Skill[]) => Skill[];
}) {
  // `load_skills: false` wins over a list.
  const names = options.loadSkills && options.skills !== undefined ? subagentNameList(options.skills) : undefined;
  let discovered: Skill[] = [];
  let activeTools: () => readonly string[] = () => [];
  let effectiveExactPrompt = options.exactSystemPrompt;
  const suffix = (): string => {
    if (!options.loadSkills) return "";
    if (names === undefined) {
      // Replace mode keeps the catalog, as pi does under `--system-prompt`.
      const tools = activeTools();
      const reader = tools.includes("read") ? "read" : tools.includes("bash") ? "bash" : undefined;
      return reader ? formatSkillsForPrompt(discovered, reader) : "";
    }
    // Names are only looked up among the skills the SDK discovered, never used as paths.
    return names.map((name) => {
      const skill = discovered.find((item) => item.name === name);
      if (!skill) return `Skill ${JSON.stringify(name)} not found in SDK discovery.`;
      try {
        const { rest } = parseFrontmatter(readFileSync(skill.filePath, "utf8"));
        return `## Skill: ${name}\nLocation: ${skill.filePath}\nBase directory for relative references: ${skill.baseDir}\n\n${rest.trim()}`;
      } catch (error) {
        return `Skill ${JSON.stringify(name)} unreadable at ${skill.filePath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }).join("\n\n");
  };
  const compose: InlineExtension = {
    name: "pi-web-subagent-skills",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const skillsText = suffix();
        if (!skillsText && options.exactSystemPrompt === undefined) return undefined;
        const base = options.exactSystemPrompt ?? event.systemPrompt;
        const prompt = skillsText ? `${base}\n\n${skillsText}` : base;
        if (options.exactSystemPrompt !== undefined) effectiveExactPrompt = prompt;
        return { systemPrompt: prompt };
      });
    },
  };
  const needsProjection = names !== undefined || options.exactSystemPrompt !== undefined;
  const loaderOptions: Pick<ConstructorParameters<typeof DefaultResourceLoader>[0], "noSkills" | "skillsOverride" | "extensionFactories"> = {
    // Off means pi's `noSkills`, which still keeps the skills an extension provides.
    noSkills: !options.loadSkills,
    ...((options.loadSkills && needsProjection) || options.filterSkills ? {
      skillsOverride: (base) => {
        // Filter before either the catalog or named preload can see the SDK collision winners.
        discovered = options.filterSkills?.(base.skills) ?? base.skills;
        return { ...base, skills: names !== undefined ? [] : discovered };
      },
    } : {}),
    ...(needsProjection ? { extensionFactories: [compose] } : {}),
  };
  return {
    loaderOptions,
    setActiveToolsGetter(getter: () => readonly string[]) { activeTools = getter; },
    getExactSystemPrompt: options.exactSystemPrompt === undefined ? undefined : () => effectiveExactPrompt!,
  };
}
