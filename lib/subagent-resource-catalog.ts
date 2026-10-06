import { DefaultPackageManager, SettingsManager, loadSkills, type PathMetadata, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { basename, dirname, join, relative, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { satisfies, validRange } from "semver";
import { parseNpmSource } from "./npm-source";
import type { SubagentResourceSelection } from "./subagent-resource-selection";

export interface SubagentResourceItem {
  name: string;
  path: string;
  identity: string;
  names: string[];
  pathAliases?: string[];
  metadata: PathMetadata;
  enabled: boolean;
  description?: string;
}
export interface SubagentResourceCatalog {
  skills: SubagentResourceItem[];
  extensions: SubagentResourceItem[];
  diagnostics: ResourceDiagnostic[];
}
/** Stable deduplication keeps distinct SDK collision winner/loser evidence. */
export function uniqueResourceDiagnostics(diagnostics: ResourceDiagnostic[]): ResourceDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([diagnostic.type, diagnostic.path, diagnostic.message, diagnostic.collision?.resourceType, diagnostic.collision?.name, diagnostic.collision?.winnerPath, diagnostic.collision?.loserPath]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resourceIdentity(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}
export function explicitResourcePath(value: string, cwd: string): string | undefined {
  if (!value.startsWith("~") && !value.includes("/") && !value.includes("\\")) return undefined;
  const path = value.replaceAll("\\", "/");
  return resolve(cwd, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}

/** Only concrete entry files reach additionalExtensionPaths. The SDK resolves manifests. */
function concreteExtension(path: string): string | undefined {
  try {
    if (statSync(path).isFile()) return path;
    for (const file of ["index.ts", "index.js"]) {
      const entry = join(path, file);
      if (existsSync(entry) && statSync(entry).isFile()) return entry;
    }
  } catch { /* diagnosed by catalog/selection */ }
  return undefined;
}
function extensionNames(path: string, metadata: PathMetadata): string[] {
  const file = basename(path).replace(/\.[^.]+$/, "");
  const names = [file === "index" ? basename(dirname(path)) : file];
  if (metadata.origin === "package") {
    const sourceName = parseNpmSource(metadata.source)?.name;
    if (sourceName) names.push(sourceName.replace(/^@[^/]+\//, ""));
    if (metadata.packageRoot) {
      try {
        const manifest = JSON.parse(readFileSync(join(metadata.packageRoot, "package.json"), "utf8"));
        if (typeof manifest.name === "string") names.push(manifest.name.replace(/^@[^/]+\//, ""));
      } catch { /* a local package need not have a manifest */ }
    }
  }
  return [...new Set(names.map((name) => name.toLowerCase()))];
}
export function assertResourceSettingsReadable(manager: SettingsManager): void {
  const errors = manager.drainErrors();
  if (errors.length) throw new Error(errors.map(({ scope, error }) => `${scope} settings: ${error.message}`).join("; "));
}

/** Readiness only, not package resolution: all locations come from public SDK metadata. */
function unavailablePackageReason(source: string, installedPath: string | undefined, resolved: boolean): string | undefined {
  if (!installedPath || !existsSync(installedPath)) return "not installed";
  try {
    const stats = statSync(installedPath);
    const npm = parseNpmSource(source);
    if (!stats.isDirectory() && (npm || !stats.isFile())) return "not ready: installation is not a regular package path";
    // A resolved resource already passed SDK readiness (including inherited package deltas).
    if (npm && !resolved) {
      const manifest = JSON.parse(readFileSync(join(installedPath, "package.json"), "utf8").replace(/^\uFEFF/, ""));
      if (typeof manifest.version !== "string" || !manifest.version) return "not ready: installed version is unavailable";
      const range = npm.version ? validRange(npm.version) : null;
      if (range && !satisfies(manifest.version, range)) return "not ready: installed version does not match the configured range";
    }
  } catch {
    return "not ready: installation or package manifest is unreadable";
  }
  return undefined;
}

/** Read both scopes without adopting project executable settings (npmCommand, shell, etc.). */
function catalogInspectionSettings(source: SettingsManager): SettingsManager {
  assertResourceSettingsReadable(source);
  const project = source.getProjectSettings();
  const scopes = {
    global: source.getGlobalSettings(),
    project: Object.fromEntries(["packages", "extensions", "skills", "prompts", "themes"].map((key) => [key, project[key as keyof typeof project]])),
  };
  // Read-only snapshots. SDK scope visibility here is inspection, never execution approval.
  // Legacy npm location queries may use the trusted host/global command only, not a project override.
  return SettingsManager.fromStorage({ withLock(scope, fn) { fn(JSON.stringify(scopes[scope])); } });
}

/** Static inspection only: no project command or extension is executed; never passed to services. */
export async function readSubagentResourceCatalog(cwd: string, agentDir: string, source = SettingsManager.create(cwd, agentDir)): Promise<SubagentResourceCatalog> {
  const manager = catalogInspectionSettings(source);
  assertResourceSettingsReadable(manager);
  const diagnostics: ResourceDiagnostic[] = [];
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager: manager });
  const skippedSources = new Set<string>();
  const paths = await packageManager.resolve(async (source) => {
    skippedSources.add(source);
    return "skip";
  });
  // PI_OFFLINE skips installation *before* onMissing runs. Inspect public configured paths
  // independently so missing/incomplete installs produce the same diagnostics offline.
  const packageResources = [...paths.extensions, ...paths.skills, ...paths.prompts, ...paths.themes];
  for (const pkg of packageManager.listConfiguredPackages()) {
    const resource = packageResources.find((entry) => entry.metadata.origin === "package" && entry.metadata.source === pkg.source && entry.metadata.scope === pkg.scope);
    const installedPath = resource?.metadata.packageRoot ?? resource?.metadata.baseDir ?? pkg.installedPath;
    const reason = unavailablePackageReason(pkg.source, installedPath, resource !== undefined);
    if (!reason) continue;
    diagnostics.push({ type: "warning", path: installedPath, message: `Package unavailable locally (${reason}, ${pkg.scope} scope): ${pkg.source}` });
    skippedSources.delete(pkg.source);
  }
  // Keep SDK callback evidence for any effective source not represented by a declaration.
  for (const source of skippedSources) diagnostics.push({ type: "warning", message: `Package unavailable locally (not ready): ${source}` });
  assertResourceSettingsReadable(manager);
  assertResourceSettingsReadable(source);
  const extensions: SubagentResourceItem[] = [];
  for (const resource of paths.extensions) {
    const path = concreteExtension(resource.path);
    if (!path) {
      diagnostics.push({ type: "warning", path: resource.path, message: "No concrete extension entry file; select a specific file instead" });
      continue;
    }
    const names = extensionNames(path, resource.metadata);
    extensions.push({ ...resource, path, identity: resourceIdentity(path), name: names[0], names });
  }
  // Parse each SDK root independently to retain the losing sources, then report SDK collisions.
  const skills: SubagentResourceItem[] = [];
  for (const resource of paths.skills) {
    const loaded = loadSkills({ cwd, agentDir, skillPaths: [resource.path], includeDefaults: false });
    diagnostics.push(...loaded.diagnostics);
    for (const skill of loaded.skills) {
      if (skills.some((entry) => entry.identity === resourceIdentity(skill.filePath))) continue;
      skills.push({ name: skill.name, names: [skill.name.toLowerCase()], description: skill.description, path: skill.filePath, identity: resourceIdentity(skill.filePath), metadata: resource.metadata, enabled: resource.enabled });
      if (skill.name !== basename(skill.baseDir)) diagnostics.push({ type: "warning", path: skill.filePath, message: `Skill name ${skill.name} differs from its directory; selection uses the SDK name, not third-party full-text preloading` });
    }
  }
  const all = loadSkills({ cwd, agentDir, skillPaths: paths.skills.filter((r) => r.enabled).map((r) => r.path), includeDefaults: false });
  // Per-root parsing already supplied validation warnings; this pass adds only cross-root collisions.
  diagnostics.push(...all.diagnostics.filter((diagnostic) => diagnostic.type === "collision"));
  for (const entries of [skills, extensions]) {
    for (const name of new Set(entries.flatMap((entry) => entry.names))) {
      const owners = new Set(entries.filter((entry) => entry.names.includes(name)).map((entry) => entry.identity));
      if (owners.size > 1) diagnostics.push({ type: "warning", message: `Ambiguous resource name: ${name}. Select a concrete file; no fallback to all.` });
    }
  }
  for (const entry of [...skills, ...extensions]) {
    entry.pathAliases = [entry.path, entry.identity, `./${relative(cwd, entry.path).replaceAll("\\", "/")}`];
    const homeRelative = relative(homedir(), entry.path);
    if (!homeRelative.startsWith("..") && !homeRelative.startsWith("/")) entry.pathAliases.push(`~/${homeRelative.replaceAll("\\", "/")}`);
    if (entry.path !== entry.identity) diagnostics.push({ type: "warning", path: entry.path, message: "Symlink resource uses SDK real-file identity; third-party name/discovery equivalence is not guaranteed" });
  }
  return { skills, extensions, diagnostics: uniqueResourceDiagnostics(diagnostics) };
}

/** Names never broaden on ambiguity; wildcard and paths can coexist. */
export function selectCatalogResources(entries: SubagentResourceItem[], selection: SubagentResourceSelection, cwd: string): { items: SubagentResourceItem[]; diagnostics: ResourceDiagnostic[] } {
  if (typeof selection === "boolean") return { items: selection ? entries.filter((entry) => entry.enabled) : [], diagnostics: [] };
  const items: SubagentResourceItem[] = selection.includes("*") ? entries.filter((entry) => entry.enabled) : [];
  const diagnostics: ResourceDiagnostic[] = [];
  for (const value of selection) {
    if (value === "*") continue;
    const path = explicitResourcePath(value, cwd);
    const matches = entries.filter((entry) => path ? entry.identity === resourceIdentity(path) : entry.names.includes(value.toLowerCase()));
    const identities = new Set(matches.map((entry) => entry.identity));
    if (identities.size !== 1) {
      diagnostics.push({ type: "warning", path: value, message: identities.size ? `Ambiguous resource: ${value}; select a concrete file` : `Unknown resource: ${value}; retained, not loaded` });
      continue;
    }
    items.push(matches[0]);
  }
  return { items: [...new Map(items.map((item) => [item.identity, item])).values()], diagnostics };
}

/** Explicit paths outside discovery are allowed only as concrete local files, never package specs. */
export function addExplicitResources(catalog: SubagentResourceCatalog, selections: { skills: SubagentResourceSelection; extensions: SubagentResourceSelection }, cwd: string, agentDir: string): void {
  for (const kind of ["skills", "extensions"] as const) {
    const selection = selections[kind];
    if (!Array.isArray(selection)) continue;
    for (const value of selection) {
      const path = explicitResourcePath(value, cwd);
      if (!path || catalog[kind].some((entry) => entry.identity === resourceIdentity(path))) continue;
      const metadata: PathMetadata = { source: "explicit", scope: "temporary", origin: "top-level", baseDir: dirname(path) };
      if (kind === "extensions") {
        try {
          if (!statSync(path).isFile()) continue;
          const names = extensionNames(path, metadata);
          catalog.extensions.push({ path, identity: resourceIdentity(path), name: names[0], names, enabled: true, metadata });
        } catch { /* selectCatalogResources reports unknown */ }
      } else if (path.toLowerCase().endsWith(".md")) {
        try {
          // A .md directory would make the SDK recurse, leaking its children through '*'.
          if (!statSync(path).isFile()) continue;
          const loaded = loadSkills({ cwd, agentDir, skillPaths: [path], includeDefaults: false });
          catalog.diagnostics.push(...loaded.diagnostics);
          for (const skill of loaded.skills) catalog.skills.push({ path: skill.filePath, identity: resourceIdentity(skill.filePath), name: skill.name, names: [skill.name.toLowerCase()], enabled: true, metadata });
        } catch { /* selectCatalogResources reports unknown; never expand directories */ }
      }
    }
  }
}
