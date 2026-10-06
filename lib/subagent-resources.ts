import { createAgentSessionServices, SettingsManager, type CreateAgentSessionServicesOptions, type Skill } from "@earendil-works/pi-coding-agent";
import { isPathWithinRoots } from "./path-security";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { addExplicitResources, assertResourceSettingsReadable, explicitResourcePath, readSubagentResourceCatalog, resourceIdentity, selectCatalogResources, uniqueResourceDiagnostics, type SubagentResourceItem } from "./subagent-resource-catalog";
import type { SubagentResourceSelection } from "./subagent-resource-selection";
import { allowedSubagentTools, createSubagentToolPolicyExtension, type SubagentHostToolAdmission, type SubagentToolPolicy } from "./subagent-tool-policy";
import { createPiWebBuiltinExtensions, scopedBuiltinExtensionSwitches } from "./builtin-extensions";
import type { McpHost } from "./mcp-host";
import { createReadOnlyMcpPolicyExtension } from "./mcp-read-only-policy";
import type { SubagentMcpServerRef } from "./subagents";
import { CODEMODE_EXTENSION_PATH, MCP_EXTENSION_PATH, TOOL_SEARCH_EXTENSION_PATH } from "./mcp-command";

/**
 * The shared host admission predicate. `declare` gates builtin discovery/active
 * loadout, `execute` additionally validates the live roster and explicit server.
 * The phase is an explicit parameter, never inferred from an absent input: a
 * no-argument aggregate call is a real execution too.
 */
export function subagentHostToolAdmission(policy: { codeMode?: boolean; loadMcp?: boolean }, host?: Pick<McpHost, "admitsTool">): SubagentHostToolAdmission {
  return (tool, phase, input) => {
    if (tool.sourceInfo?.source !== "builtin") return false;
    if (tool.sourceInfo.path === CODEMODE_EXTENSION_PATH) return policy.codeMode === true && tool.name === "codemode";
    if (tool.sourceInfo.path === TOOL_SEARCH_EXTENSION_PATH) return policy.loadMcp === true && tool.name === "tool_search";
    return policy.loadMcp === true && (host?.admitsTool(tool, phase, input) ?? false);
  };
}

const RESOURCE_KEYS = ["packages", "extensions", "skills", "prompts", "themes"] as const;
function clearResources(settings: ReturnType<SettingsManager["getGlobalSettings"]>): string {
  const copy = structuredClone(settings);
  for (const key of RESOURCE_KEYS) copy[key] = [];
  return JSON.stringify(copy);
}

type SettingsObject = Record<string, unknown>;
const isSettingsObject = (value: unknown): value is SettingsObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** A scope-preserving SDK storage: fresh source baseline plus memory-only setter deltas. */
export function createSubagentMemorySettings(source: SettingsManager): SettingsManager {
  assertResourceSettingsReadable(source);
  // Store only changed JSON leaves (arrays are atomic); undefined is a deletion tombstone.
  // SDK owns merging, migration, setters and write ordering. No effective/merged settings are persisted.
  // A no-op setter does not pin a baseline value: public storage cannot observe mutation intent.
  const overlays = { global: new Map<string, { path: string[]; value: unknown }>(), project: new Map<string, { path: string[]; value: unknown }>() };
  return SettingsManager.fromStorage({
    withLock(scope, fn) {
      const current: SettingsObject = JSON.parse(clearResources(scope === "global" ? source.getGlobalSettings() : source.getProjectSettings()));
      const overlay = overlays[scope];
      for (const { path, value } of overlay.values()) {
        let target = current;
        for (const key of path.slice(0, -1)) {
          if (!isSettingsObject(target[key])) target[key] = {};
          target = target[key] as SettingsObject;
        }
        const key = path[path.length - 1];
        if (value === undefined) delete target[key]; else target[key] = structuredClone(value);
      }
      const next = fn(JSON.stringify(current));
      if (next === undefined) return;
      const recordChanges = (before: SettingsObject, after: SettingsObject, parent: string[] = []) => {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
          const path = [...parent, key];
          if (isSettingsObject(after[key]) && (before[key] === undefined || isSettingsObject(before[key]))) {
            recordChanges(isSettingsObject(before[key]) ? before[key] : {}, after[key], path);
          } else {
            // Replacing/deleting a parent supersedes older child changes.
            for (const [id, change] of overlay) if (path.every((part, i) => change.path[i] === part)) overlay.delete(id);
            overlay.set(JSON.stringify(path), { path, value: after[key] });
          }
        }
      };
      recordChanges(current, JSON.parse(clearResources(JSON.parse(next))));
    },
  }, { projectTrusted: source.isProjectTrusted() });
}

export interface SubagentResourcePolicy {
  loadSkills: boolean;
  loadExtensions: boolean;
  skills?: SubagentResourceSelection;
  extensions?: SubagentResourceSelection;
  builtinTools?: string[];
  toolPolicy?: SubagentToolPolicy;
  codeMode?: boolean;
  loadMcp?: boolean;
  mcpServers?: SubagentMcpServerRef[];
}

/** Any discovered project source or selected project alias makes the canonical file project-owned. */
function projectExtensionIdentities(entries: SubagentResourceItem[], selection: SubagentResourceSelection, cwd: string): Set<string> {
  const roots = new Set([cwd, resourceIdentity(cwd)]);
  const projectPath = (path: string) => isPathWithinRoots(path, roots) || isPathWithinRoots(resourceIdentity(path), roots);
  const identities = new Set(entries.filter((entry) => entry.metadata.scope === "project" || projectPath(entry.path) || projectPath(entry.identity)).map((entry) => entry.identity));
  // Selection can name a project symlink whose real file already has a user-scope catalog entry.
  if (Array.isArray(selection)) for (const value of selection) {
    const path = explicitResourcePath(value, cwd);
    if (path && projectPath(path)) identities.add(resourceIdentity(path));
  }
  return identities;
}

/** Reuse original services/model runtime/cwd. Only restricted resources get a transient SDK loader. */
export async function createSubagentSessionServices(options: CreateAgentSessionServicesOptions & { agentDir: string; settingsManager: SettingsManager }, policy: SubagentResourcePolicy) {
  policy = structuredClone(policy);
  const { cwd, agentDir, settingsManager: source } = options;
  assertResourceSettingsReadable(source);
  let policyLoader: Awaited<ReturnType<typeof createAgentSessionServices>>["resourceLoader"] | undefined;
  const builtins: Awaited<ReturnType<typeof createPiWebBuiltinExtensions>> | undefined = policy.codeMode || policy.loadMcp ? await createPiWebBuiltinExtensions({
    agentDir,
    capability: {
      cwd, codeMode: policy.codeMode === true, loadMcp: policy.loadMcp === true, mcpServers: structuredClone(policy.mcpServers ?? []),
      builtinEnabled: async (name) => (await scopedBuiltinExtensionSwitches(source, cwd, agentDir))[name].enabled,
      allowedTools: (tools) => policyLoader && policy.toolPolicy
        ? allowedSubagentTools(policy.builtinTools ?? [], policy.toolPolicy, tools, policyLoader.getExtensions().extensions, subagentHostToolAdmission(policy, builtins?.mcpHost))
        : new Set(),
    },
  }) : undefined;
  const admitHost = subagentHostToolAdmission(policy, builtins?.mcpHost);
  options = { ...options, resourceLoaderOptions: { ...options.resourceLoaderOptions,
    extensionFactories: [...builtins?.extensions ?? [], ...options.resourceLoaderOptions?.extensionFactories ?? [],
      ...(policy.loadMcp ? [createReadOnlyMcpPolicyExtension(policy.builtinTools ?? [])] : [])],
  } };
  // Compose host factories in one place on both create and cold restore. Reload reuses
  // this factory but obtains the newly approved, trust-checked roster from the loader.
  if (policy.toolPolicy) options = {
    ...options,
    resourceLoaderOptions: {
      ...options.resourceLoaderOptions,
      extensionFactories: [
        ...options.resourceLoaderOptions?.extensionFactories ?? [],
        createSubagentToolPolicyExtension(policy.builtinTools ?? [], policy.toolPolicy, () => {
          if (!policyLoader) throw new Error("Subagent resource roster not ready");
          return policyLoader.getExtensions().extensions;
        }, admitHost),
      ],
    },
  };
  assertResourceSettingsReadable(source);
  const selections = { skills: policy.skills ?? policy.loadSkills, extensions: policy.extensions ?? policy.loadExtensions };
  if (selections.skills === true && selections.extensions === true) {
    const services = await createAgentSessionServices(options);
    policyLoader = services.resourceLoader;
    assertResourceSettingsReadable(source);
    const reload = services.resourceLoader.reload.bind(services.resourceLoader);
    services.resourceLoader.reload = async () => {
      source.setProjectTrusted(getProjectTrustStatus(cwd, agentDir).trusted);
      await reload(projectTrustReloadOptions(cwd, agentDir));
      assertResourceSettingsReadable(source);
    };
    return { ...services, mcpHost: builtins?.mcpHost };
  }

  const settingsManager = createSubagentMemorySettings(source);
  const extensionPaths: string[] = [];
  const skillPaths: string[] = [];
  let approvedSkills: SubagentResourceItem[] = [];
  let approvedExtensions: SubagentResourceItem[] = [];
  let diagnostics: Awaited<ReturnType<typeof readSubagentResourceCatalog>>["diagnostics"] = [];
  const prepare = async () => {
    // Resolve statically before deciding trust: explicit project files also require a real decision.
    // Inspection excludes project executable settings and is never passed to services.
    const catalog = await readSubagentResourceCatalog(cwd, agentDir);
    addExplicitResources(catalog, selections, cwd, agentDir);
    const skills = selectCatalogResources(catalog.skills, selections.skills, cwd);
    const extensions = selectCatalogResources(catalog.extensions, selections.extensions, cwd);
    const projectIdentities = projectExtensionIdentities(catalog.extensions, selections.extensions, cwd);
    const trusted = getProjectTrustStatus(cwd, agentDir, { additionalProjectResources: extensions.items.some((entry) => projectIdentities.has(entry.identity)) }).trusted;
    source.setProjectTrusted(trusted);
    await source.reload();
    assertResourceSettingsReadable(source);
    // Explicit reload boundary: both scopes read the refreshed source plus local setter deltas.
    await settingsManager.reload();
    settingsManager.setProjectTrusted(trusted);
    assertResourceSettingsReadable(settingsManager);
    const explicitSkills = new Set(selectCatalogResources(catalog.skills, Array.isArray(selections.skills) ? selections.skills.filter((entry) => entry !== "*") : false, cwd).items.map((entry) => entry.identity));
    approvedSkills = skills.items.filter((entry) => trusted || explicitSkills.has(entry.identity) || entry.metadata.scope !== "project");
    approvedExtensions = extensions.items.filter((entry) => trusted || !projectIdentities.has(entry.identity));
    diagnostics = [...catalog.diagnostics, ...skills.diagnostics, ...extensions.diagnostics];
    for (const entry of extensions.items.filter((item) => !approvedExtensions.includes(item))) diagnostics.push({ type: "warning", path: entry.path, message: "Project extension not loaded: project trust required" });
    // Load the identity we approved, not an alias that can be retargeted before SDK import.
    extensionPaths.splice(0, extensionPaths.length, ...(builtins ? [CODEMODE_EXTENSION_PATH, TOOL_SEARCH_EXTENSION_PATH, MCP_EXTENSION_PATH] : []), ...approvedExtensions.map((entry) => entry.identity));
    skillPaths.splice(0, skillPaths.length, ...approvedSkills.map((entry) => entry.path));
  };
  const skillsOverride = (base: { skills: Skill[]; diagnostics: typeof diagnostics }) => ({
    skills: selections.skills === false ? [] : selections.skills === true || (Array.isArray(selections.skills) && selections.skills.includes("*")) ? base.skills : base.skills.filter((skill) => approvedSkills.some((entry) => entry.identity === resourceIdentity(skill.filePath) && entry.name === skill.name)),
    diagnostics: uniqueResourceDiagnostics([...base.diagnostics, ...diagnostics]),
  });
  await prepare();
  const services = await createAgentSessionServices({
    ...options, settingsManager,
    // Current real trust is already resolved. Do not bootstrap-import temporary project paths.
    resourceLoaderReloadOptions: undefined,
    resourceLoaderOptions: {
      ...options.resourceLoaderOptions,
      noExtensions: true, noSkills: true,
      // Explicit builtin paths bypass noExtensions only; their factories still consult
      // the un-cleared source settings above. Excluded user modules never run.
      additionalExtensionPaths: extensionPaths, additionalSkillPaths: skillPaths,
      skillsOverride,
    },
  });
  const loader = services.resourceLoader;
  policyLoader = loader;
  const restoreSources = () => {
    for (const extension of loader.getExtensions().extensions) {
      const entry = approvedExtensions.find((item) => item.identity === resourceIdentity(extension.path));
      if (!entry) continue; // inline host factories have no catalog source
      extension.sourceInfo = { ...entry.metadata, path: extension.path };
      for (const tool of extension.tools.values()) tool.sourceInfo = extension.sourceInfo;
      for (const command of extension.commands.values()) command.sourceInfo = extension.sourceInfo;
    }
    for (const skill of loader.getSkills().skills) {
      const entry = approvedSkills.find((item) => item.identity === resourceIdentity(skill.filePath));
      if (entry) skill.sourceInfo = { ...entry.metadata, path: skill.filePath };
    }
  };
  restoreSources();
  const reload = loader.reload.bind(loader);
  loader.reload = async () => {
    await prepare();
    await reload();
    restoreSources();
    assertResourceSettingsReadable(settingsManager);
  };
  const extend = loader.extendResources.bind(loader);
  loader.extendResources = (paths) => {
    // SDK skillsOverride runs on resources_discover and every extendResources call too.
    extend({ skillPaths: paths.skillPaths });
    restoreSources();
  };
  return { ...services, mcpHost: builtins?.mcpHost };
}
