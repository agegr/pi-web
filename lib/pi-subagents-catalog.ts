import { execSync } from "child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "path";
import { CONFIG_DIR_NAME, DefaultPackageManager, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./frontmatter";

/**
 * The pi-subagents agent catalog for one cwd: every agent definition the
 * installed `pi-subagents` package and pi's settings files make available.
 *
 * Pi Web does not import pi-subagents — its exports map forbids `src/*` — so
 * this module reads the same files `src/agents/agents.js` discovers and
 * reimplements the read-only half of that discovery. Only files are read, and
 * nothing here executes agent code.
 *
 * Sources follow pi-subagents' precedence: project > user > package > builtin.
 * Same-name entries from every source are listed; rows a higher-precedence
 * source shadows carry `overriddenBy`.
 *
 * Known divergences from pi-subagents' own discovery, kept intentional:
 * - `agentExcludeDirs` and wildcard (`*`) `agentScanDirs` patterns are not
 *   implemented; every existing non-wildcard scan dir is read.
 * - `agentOverridesByProvider` is not applied: selecting one needs a preferred
 *   model provider, which the panel does not have.
 * - Frontmatter is parsed with js-yaml, which is stricter than the package's
 *   line parser, so a malformed block scalar hides a row the runtime keeps.
 * - Relative `agentScanDirs` entries resolve against their settings file's
 *   directory; pi-subagents resolves them against the process cwd.
 * - The runtime throws on invalid override values (e.g. `description: ""`) and
 *   on the removed `fallbackModels` field; the catalog degrades to a partial
 *   catalog instead (documented never-throw stance).
 */

export type AgentCatalogSource = "builtin" | "package" | "user" | "project";

/** Which settings entry disables the effective agent, and whether a named override or the bulk switch did it. */
export interface AgentCatalogDisabledSource {
  scope: "user" | "project";
  via: "override" | "bulk";
}

export interface AgentCatalogAgent {
  name: string;
  displayName?: string;
  description: string;
  source: AgentCatalogSource;
  filePath: string;
  aliases?: string[];
  model?: string;
  thinking?: string;
  tools?: string[];
  excludeTools?: string[];
  /**
   * The trimmed markdown body that follows the frontmatter close delimiter —
   * the agent's system instructions. Absent when the definition has no body.
   */
  prompt?: string;
  advertise?: boolean;
  disabled?: boolean;
  /**
   * Set with `disabled === true` when a settings entry disabled this agent:
   * `override` is `subagents.agentOverrides.<name>.disabled`, `bulk` is
   * `subagents.disableBuiltins`. Absent when nothing disabled it, so the panel
   * never reads a stale reason. The winning row's value is projected onto every
   * same-name row, because the winner is the one the runtime dispatches.
   */
  disabledSource?: AgentCatalogDisabledSource;
  /** Source of the same-name entry that wins over this one, if any. */
  overriddenBy?: AgentCatalogSource;
  /** Set only when the definition provably cannot run — an external CLI missing from PATH. */
  executable?: boolean;
}

/** pi-subagents' `AGENT_SOURCE_PRIORITY`. */
const SOURCE_RANK: Record<AgentCatalogSource, number> = {
  builtin: 0,
  package: 1,
  user: 2,
  project: 3,
};

const EXTRA_AGENT_DIRS_ENV = "PI_SUBAGENT_EXTRA_AGENT_DIRS";
const PI_SUBAGENTS_PACKAGE = "pi-subagents";

/** Override fields this catalog shows. Everything else in a settings override is runtime-only. */
interface CatalogSettings {
  overrides: Record<string, Record<string, unknown>>;
  defaultModel?: string;
  defaultProvider?: string;
  defaultThinking?: string;
  disableBuiltins?: boolean;
  disableThinking?: boolean;
  agentScanDirs: string[];
}

/**
 * The keys `parseBuiltinOverrideEntry` recognizes. An override entry holding
 * none of them is dropped by the runtime's `Object.keys(override).length > 0`
 * guard, so it neither overrides nor shields a builtin; the catalog mirrors
 * that set instead of accepting any non-empty object.
 */
const RECOGNIZED_OVERRIDE_FIELDS = new Set([
  "description",
  "output",
  "outputMode",
  "model",
  "fast",
  "thinking",
  "systemPromptMode",
  "inheritProjectContext",
  "inheritGlobalContext",
  "inheritSkills",
  "defaultContext",
  "acceptanceRole",
  "disabled",
  "toolBudget",
  "systemPrompt",
  "machine",
  "defaultReads",
  "defaultProvider",
  "skills",
  "tools",
  "excludeTools",
  "allowNestedSubagents",
  "allowedAgents",
  "extensions",
  "subagentOnlyExtensions",
  "mutationTools",
]);

function emptySettings(): CatalogSettings {
  return { overrides: {}, agentScanDirs: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestAgentDirs(section: unknown): string[] {
  if (!isRecord(section) || !Array.isArray(section.agents)) return [];
  return section.agents.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Booleans in an agent file read as YAML (`true`) or as the string pi-subagents'
 * own line parser produces (`"true"`); both mean the same thing here.
 */
function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `parseFrontmatterList`: comma-separated scalars, YAML block lists, or a repeated key's list. */
function frontmatterList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value)
    ? value.map(String)
    : String(value)
      .split("\n")
      .flatMap((line) => {
        const text = line.trim();
        const item = /^-\s+(.+)$/.exec(text);
        return (item?.[1] ?? text).split(",");
      });
  const items = raw.map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readSubagentSettings(filePath: string): CatalogSettings {
  const subagents = readJsonObject(filePath)?.subagents;
  if (!isRecord(subagents)) return emptySettings();

  const overrides: Record<string, Record<string, unknown>> = {};
  if (isRecord(subagents.agentOverrides)) {
    for (const [name, value] of Object.entries(subagents.agentOverrides)) {
      // The runtime's parser drops an entry with no recognized field, so such an
      // object neither overrides nor shields a builtin from bulk disable.
      if (isRecord(value) && Object.keys(value).some((key) => RECOGNIZED_OVERRIDE_FIELDS.has(key))) {
        overrides[name] = value;
      }
    }
  }
  return {
    overrides,
    ...(stringValue(subagents.defaultModel) ? { defaultModel: stringValue(subagents.defaultModel) } : {}),
    ...(stringValue(subagents.defaultProvider) ? { defaultProvider: stringValue(subagents.defaultProvider) } : {}),
    ...(stringValue(subagents.defaultThinking) ? { defaultThinking: stringValue(subagents.defaultThinking) } : {}),
    ...(typeof subagents.disableBuiltins === "boolean" ? { disableBuiltins: subagents.disableBuiltins } : {}),
    ...(typeof subagents.disableThinking === "boolean" ? { disableThinking: subagents.disableThinking } : {}),
    agentScanDirs: Array.isArray(subagents.agentScanDirs)
      ? subagents.agentScanDirs.filter((dir): dir is string => typeof dir === "string" && dir.trim().length > 0)
      : [],
  };
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function realPathOrResolve(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return resolve(dir);
  }
}

/** `~/.pi` and `~/.agents` are user configuration, never an implicit project. */
function isHomeDirectory(dir: string): boolean {
  const windowsProfile = process.env.HOMEDRIVE && process.env.HOMEPATH
    ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
    : undefined;
  for (const value of [homedir(), process.env.HOME, process.env.USERPROFILE, windowsProfile]) {
    const trimmed = value?.trim();
    if (!trimmed || !isDirectory(trimmed)) continue;
    if (realPathOrResolve(trimmed) === realPathOrResolve(dir)) return true;
  }
  return false;
}

function projectRootCandidates(cwd: string): string[] {
  const roots: string[] = [];
  let current = resolve(cwd);
  while (true) {
    if (isDirectory(current) && isHomeDirectory(current)) return roots;
    if (isDirectory(join(current, CONFIG_DIR_NAME)) || isDirectory(join(current, ".agents"))) {
      roots.push(current);
    }
    const parent = dirname(current);
    if (parent === current) return roots;
    current = parent;
  }
}

function findNearestGitRoot(cwd: string): string | null {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * `findConfiguredProjectRoot`: the nearest ancestor holding `.pi` or `.agents`,
 * unless a `subagents.projectRootResolution: "git-root"` setting in the walk
 * redirects discovery to the repository root.
 */
export function findConfiguredProjectRoot(cwd: string): string | null {
  const candidates = projectRootCandidates(cwd);
  const nearest = candidates[0];
  if (!nearest) return null;

  let policyRoot: string | undefined;
  let policyIndex = -1;
  for (const [index, candidate] of candidates.entries()) {
    const mode = readJsonObject(join(candidate, CONFIG_DIR_NAME, "settings.json"))?.subagents;
    const resolution = isRecord(mode) ? mode.projectRootResolution : undefined;
    if (resolution === "nearest") return nearest;
    if (resolution === "git-root") {
      policyRoot = candidate;
      policyIndex = index;
      break;
    }
  }
  if (!policyRoot) return nearest;

  const gitRoot = findNearestGitRoot(cwd);
  const gitProjectRoot = gitRoot
    ? candidates.slice(policyIndex).find((candidate) => resolve(candidate) === resolve(gitRoot))
    : undefined;
  const configuredGitRoot = existsSync(join(policyRoot, ".git")) ? policyRoot : undefined;
  return gitProjectRoot ?? configuredGitRoot ?? nearest;
}

function existingDirs(dirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir) || seen.has(dir)) continue;
    seen.add(dir);
    result.push(dir);
  }
  return result;
}

function expandHome(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

/** Relative scan dirs resolve against the settings file, not the process cwd. */
function resolveScanDirs(entries: readonly string[], baseDir: string): string[] {
  return entries.map((entry) => {
    const expanded = expandHome(entry.trim());
    return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
  });
}

function agentDir(): string {
  try {
    return getAgentDir();
  } catch {
    return "";
  }
}

/**
 * pi's own package-source resolution for a configured settings entry:
 * `npm:`/`git:` live under the scope's `npm/node_modules` or `git/` tree, and a
 * `file:`/bare path is resolved against the settings file's base dir.
 */
function resolvePackageSource(source: string, baseDir: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("npm:")) {
    const name = trimmed.slice(4).replace(/@[^@/]*$/, "").trim();
    return name ? join(baseDir, "npm", "node_modules", name) : undefined;
  }
  if (trimmed.startsWith("git:")) {
    const spec = trimmed.slice(4).replace(/@[^@/]*$/, "").replace(/\.git$/, "");
    const slash = spec.indexOf("/");
    return slash < 0 ? undefined : join(baseDir, "git", spec.slice(0, slash), spec.slice(slash + 1));
  }
  const local = trimmed.startsWith("file:") ? trimmed.slice(5) : trimmed;
  if (!local || /^[a-z]+:\/\//i.test(local)) return undefined;
  const expanded = expandHome(local);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

/** `collectPackageRootsFromNodeModules`: every installed entry, including `@scope` dirs. */
function nodeModulesPackageRoots(nodeModulesDir: string): string[] {
  if (!existsSync(nodeModulesDir)) return [];
  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const roots: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      let scopeEntries;
      try {
        scopeEntries = readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scopeEntry of scopeEntries) {
        if (scopeEntry.name.startsWith(".")) continue;
        if (!scopeEntry.isDirectory() && !scopeEntry.isSymbolicLink()) continue;
        roots.push(join(scopeDir, scopeEntry.name));
      }
      continue;
    }
    roots.push(join(nodeModulesDir, entry.name));
  }
  return roots;
}

/** `collectSettingsPackageRoots`: the roots named by a settings file's `packages`. */
function settingsPackageRoots(filePath: string, baseDir: string): string[] {
  const packages = readJsonObject(filePath)?.packages;
  if (!Array.isArray(packages)) return [];
  const roots: string[] = [];
  for (const entry of packages) {
    const source = typeof entry === "string"
      ? entry
      : isRecord(entry) && typeof entry.source === "string"
        ? entry.source
        : undefined;
    if (!source) continue;
    const root = resolvePackageSource(source, baseDir);
    if (root) roots.push(root);
  }
  return roots;
}

let cachedGlobalNpmRoot: string | null | undefined;

/** `getGlobalNpmRoot`: the default npm prefix's node_modules, skipped when PI_OFFLINE. */
function globalNpmRoot(): string | null {
  const offline = process.env.PI_OFFLINE?.toLowerCase();
  if (offline === "1" || offline === "true" || offline === "yes") return null;
  if (cachedGlobalNpmRoot !== undefined) return cachedGlobalNpmRoot;
  const windowsGlobalRoot = process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "node_modules")
    : undefined;
  if (windowsGlobalRoot && isDirectory(windowsGlobalRoot)) {
    try {
      cachedGlobalNpmRoot = realpathSync.native(windowsGlobalRoot);
      return cachedGlobalNpmRoot;
    } catch {
      // Fall through if the directory disappears while resolving it.
    }
  }
  try {
    cachedGlobalNpmRoot = realpathSync.native(execSync("npm root -g", { encoding: "utf-8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim());
    return cachedGlobalNpmRoot;
  } catch {
    cachedGlobalNpmRoot = "";
    return null;
  }
}

function userAgentDirs(settings: CatalogSettings): string[] {
  const dir = agentDir();
  return existingDirs([
    ...(process.env[EXTRA_AGENT_DIRS_ENV] ?? "").split(delimiter),
    ...(dir ? resolveScanDirs(settings.agentScanDirs, dir) : []),
    dir ? join(dir, "agents") : "",
    join(homedir(), ".agents"),
  ]);
}

/**
 * `findConfiguredProjectRoot(cwd) ?? cwd`, so a bare directory is its own
 * project. `.pi/agents` ranks above the legacy `.agents` only by directory
 * order — both are read.
 */
function projectAgentDirs(cwd: string): { root: string; dirs: string[] } {
  const root = findConfiguredProjectRoot(cwd) ?? resolve(cwd);
  const settingsPath = join(root, CONFIG_DIR_NAME, "settings.json");
  const settings = readSubagentSettings(settingsPath);
  return {
    root,
    dirs: existingDirs([
      ...resolveScanDirs(settings.agentScanDirs, dirname(settingsPath)),
      join(root, ".agents"),
      join(root, CONFIG_DIR_NAME, "agents"),
    ]),
  };
}

/** Agent dirs declared by a package's own manifest, plus pi-subagents' bundled `agents/`. */
function packageAgentDirs(cwd: string, projectRoot: string): { dirs: string[]; builtinDirs: string[] } {
  // Project-scope package reads are intentionally un-gated, mirroring
  // pi-subagents' own project-settings reads. This module only parses
  // frontmatter for display and never imports or executes the package; the
  // /api/plugins route gates its *writes* on `getProjectTrustStatus`, which
  // this read-only catalog does not need.
  //
  // The bundled built-ins come only from the *configured* pi-subagents package
  // (pi-subagents loads them from its own install dir), not from every
  // similarly-named copy the scan below finds.
  const builtinDirs = configuredPiSubagentsAgentDirs(cwd);

  // `collectPackageSubagentPaths` order: the project root's own package, then
  // project-scope roots, then user-scope (and global) roots. The package map is
  // first-wins, so project-scope packages must precede user-scope ones.
  const userAgentDir = agentDir();
  const projectConfigDir = join(projectRoot, CONFIG_DIR_NAME);
  const roots: string[] = [
    projectRoot,
    ...nodeModulesPackageRoots(join(projectConfigDir, "npm", "node_modules")),
    ...settingsPackageRoots(join(projectConfigDir, "settings.json"), projectConfigDir),
  ];
  if (userAgentDir) {
    roots.push(...nodeModulesPackageRoots(join(userAgentDir, "npm", "node_modules")));
    roots.push(...settingsPackageRoots(join(userAgentDir, "settings.json"), userAgentDir));
    const globalRoot = globalNpmRoot();
    if (globalRoot) roots.push(...nodeModulesPackageRoots(globalRoot));
  }

  const dirs: string[] = [];
  const seenRoots = new Set<string>();
  for (const candidate of roots) {
    const packageRoot = resolve(candidate);
    if (seenRoots.has(packageRoot)) continue;
    seenRoots.add(packageRoot);
    const manifest = readJsonObject(join(packageRoot, "package.json"));
    if (!manifest) continue;
    const declaredAgents = [
      manifestAgentDirs(manifest["pi-subagents"]),
      manifestAgentDirs(isRecord(manifest.pi) ? manifest.pi.subagents : undefined),
    ].flat();
    for (const entry of declaredAgents) dirs.push(resolve(packageRoot, entry));
  }
  return { dirs: existingDirs(dirs), builtinDirs: existingDirs(builtinDirs) };
}

/** The configured `pi-subagents` install's bundled `agents/`, via pi's package manager. */
function configuredPiSubagentsAgentDirs(cwd: string): string[] {
  try {
    const userAgentDir = agentDir();
    const settingsManager = SettingsManager.create(cwd, userAgentDir || undefined, { projectTrusted: true });
    const manager = new DefaultPackageManager({ cwd, agentDir: userAgentDir, settingsManager });
    const dirs: string[] = [];
    for (const pkg of manager.listConfiguredPackages()) {
      const packageRoot = pkg.installedPath ?? resolvePackageSource(pkg.source, pkg.scope === "project" ? join(cwd, CONFIG_DIR_NAME) : userAgentDir);
      if (!packageRoot) continue;
      const manifest = readJsonObject(join(packageRoot, "package.json"));
      // The bundled built-ins are one fixed package: keep only the first
      // configured copy so a user+project install cannot duplicate every row.
      if (stringValue(manifest?.name) === PI_SUBAGENTS_PACKAGE) {
        dirs.push(join(packageRoot, "agents"));
        break;
      }
    }
    return dirs;
  } catch {
    // Configured packages are optional; a broken settings file must not hide the rest.
    return [];
  }
}

function commandAvailable(command: string): boolean {
  // A command with spaces is a shell string, not a PATH lookup; probing the
  // whole string would report a false "CLI not found", so test only the binary.
  const binary = command.trim().split(/\s+/)[0] ?? "";
  if (!binary) return false;
  const hasSeparator = binary.includes("/") || binary.includes("\\");
  const candidates = isAbsolute(binary) || hasSeparator
    ? [resolve(binary)]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, binary));
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const candidate of candidates) {
    for (const extension of extensions) {
      try {
        accessSync(`${candidate}${extension}`, constants.X_OK);
        return true;
      } catch {
        // Keep probing.
      }
    }
  }
  return false;
}

/** pi-subagents' `normalizePackageName` + `IDENTIFIER_PATTERN`; an invalid name skips the row. */
function runtimePackageName(value: unknown): { name?: string; valid: boolean } {
  // The package's line parser yields every scalar as a string; js-yaml may hand
  // back a boolean/number for the same text, so normalize both spellings alike.
  if (value === undefined || value === null || value === "") return { valid: true };
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return { valid: false };
  const raw = String(value);
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/(?:^[-.]+|[-.]+$)/g, "");
  if (!normalized || !/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(normalized)) return { valid: false };
  return { name: normalized, valid: true };
}

function parseAgentFile(filePath: string, source: AgentCatalogSource): AgentCatalogAgent | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const { data, rest } = parseFrontmatter(content);
  if (!data) return null;
  // pi-subagents skips a definition missing either key, so the catalog does too.
  const name = stringValue(data.name);
  const description = stringValue(data.description);
  if (!name || !description) return null;

  // `buildRuntimeName`: a `package:` frontmatter prefix renames the agent at
  // runtime (`team.oracle`), so the catalog must fold it in or the row would
  // shadow a same-named builtin it never actually replaces.
  const parsedPackage = runtimePackageName(data.package);
  if (!parsedPackage.valid) return null;
  const runtimeName = parsedPackage.name ? `${parsedPackage.name}.${name}` : name;

  const aliases = frontmatterList(data.aliases ?? data.alias)
    ?.map((alias) => alias.trim())
    .filter((alias, index, all) => alias && alias !== runtimeName && all.indexOf(alias) === index);
  const tools = frontmatterList(data.tools);
  const excludeTools = frontmatterList(data.excludeTools);
  // `thinking: false` is an explicit off the runtime preserves as a distinct
  // value; `applyDefaults` must not treat it as "unset" and fill in a default,
  // so it is normalized to the panel's own `off` spelling.
  const rawThinking = data.thinking;
  const thinking = rawThinking === undefined || rawThinking === null
    ? undefined
    : rawThinking === false || rawThinking === "false"
      ? "off"
      : String(rawThinking).trim().toLowerCase();
  const runner = isRecord(data.runner) ? data.runner : undefined;
  const runnerCommand = runner?.type === "external-cli" ? stringValue(runner.command) : undefined;
  const displayName = stringValue(data.display_name);
  const model = stringValue(data.model);
  const advertise = booleanValue(data.advertise);
  const prompt = rest.trim();

  return {
    name: runtimeName,
    ...(displayName ? { displayName } : {}),
    description,
    source,
    filePath,
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    ...(tools ? { tools } : {}),
    ...(excludeTools ? { excludeTools } : {}),
    ...(thinking ? { thinking } : {}),
    ...(advertise !== undefined ? { advertise } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    ...(runnerCommand && !commandAvailable(runnerCommand) ? { executable: false } : {}),
  };
}

/** pi-subagents prunes these directory names while walking an agent directory. */
function prunedAgentDirName(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".pi" || name === "sync-backups";
}

/** `shouldPruneDiscoveryDir`: a pruned name, a nested worktree root, or a nested project. */
function isPrunedDiscoveryDir(rootDir: string, dirName: string, dir: string): boolean {
  if (prunedAgentDirName(dirName)) return true;
  if (existsSync(join(dir, ".git"))) return true;
  return resolve(dir) !== resolve(rootDir)
    && (isDirectory(join(dir, CONFIG_DIR_NAME)) || isDirectory(join(dir, ".agents")));
}

/** `isLegacyAgentSkillPath`: `.agents/skills` holds skills, not agent definitions. */
function isLegacySkillDir(rootDir: string, dir: string): boolean {
  const parts = relative(rootDir, dir).split(/[/\\]/).map((part) => part.toLowerCase());
  if (basename(rootDir).toLowerCase() === ".agents") parts.unshift(".agents");
  return parts.some((part, index) => part === ".agents" && parts[index + 1] === "skills");
}

function readAgentDir(dir: string, source: AgentCatalogSource): AgentCatalogAgent[] {
  const rows: AgentCatalogAgent[] = [];
  const visited = new Set<string>();
  const walk = (current: string): void => {
    let real: string;
    try {
      real = realpathSync(current);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(entryPath))) {
        if (isPrunedDiscoveryDir(dir, entry.name, entryPath)) continue;
        walk(entryPath);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!entry.name.endsWith(".md") || entry.name.endsWith(".chain.md")) continue;
      // The legacy `.agents/skills` tree holds skill files, not agents.
      if (isLegacySkillDir(dir, entryPath)) continue;
      const row = parseAgentFile(entryPath, source);
      if (row) rows.push(row);
    }
  };
  walk(dir);
  return rows;
}

function applyOverride(
  row: AgentCatalogAgent,
  override: Record<string, unknown> | undefined,
  scope?: AgentCatalogDisabledSource["scope"],
): AgentCatalogAgent {
  if (!override) return row;
  const next: AgentCatalogAgent = { ...row };
  const description = stringValue(override.description);
  if (description) next.description = description;
  // `model`/`thinking: false` clear the value after defaults, matching the
  // runtime's applyDefaults-then-override order, so no default can resurrect it.
  if (override.model === false) delete next.model;
  else if (typeof override.model === "string") next.model = override.model;
  if (override.thinking === false) delete next.thinking;
  else if (typeof override.thinking === "string") next.thinking = override.thinking;
  if (override.tools === "inherit") delete next.tools;
  else if (override.tools === false) next.tools = [];
  else if (Array.isArray(override.tools)) next.tools = override.tools.map(String);
  if (override.excludeTools === false) delete next.excludeTools;
  else if (Array.isArray(override.excludeTools)) next.excludeTools = override.excludeTools.map(String);
  if (typeof override.disabled === "boolean") {
    next.disabled = override.disabled;
    if (override.disabled && scope) next.disabledSource = { scope, via: "override" };
    else delete next.disabledSource;
  }
  return next;
}

/** pi-subagents' `applySubagentDefaults`, reduced to the fields this panel shows. */
function applyDefaults(row: AgentCatalogAgent, settings: CatalogSettings): AgentCatalogAgent {
  const next: AgentCatalogAgent = { ...row };
  // pi-subagents keeps `model` and `modelProvider` separate; the panel shows one
  // string, so only a bare model id gets the configured provider folded in.
  if (!next.model && settings.defaultModel) next.model = settings.defaultModel;
  if (next.model && settings.defaultProvider && !next.model.includes("/")) {
    next.model = `${settings.defaultProvider}/${next.model}`;
  }
  // The runtime tests `!== undefined`, not falsiness: an explicit `thinking:
  // false` (shown as `off`) survives the default-thinking fill-in.
  if (next.thinking === undefined && settings.defaultThinking) next.thinking = settings.defaultThinking;
  return next;
}

/**
 * `clearBuiltinThinking`: `subagents.disableThinking` strips a builtin's
 * thinking value unless the override that applied at the builtin's own scale
 * set one. A project-level value (true or false) suppresses the user value.
 */
function clearBuiltinThinking(
  row: AgentCatalogAgent,
  disableThinking: boolean,
  hasExplicitThinkingOverride: boolean,
): AgentCatalogAgent {
  if (!disableThinking || hasExplicitThinkingOverride || row.thinking === undefined) return row;
  const next: AgentCatalogAgent = { ...row };
  delete next.thinking;
  return next;
}

/**
 * The runtime's `applyBuiltinOverrides` ladder: a project override shields a
 * builtin from the project-wide bulk disable, a user override shields it from
 * the user-wide one, a project-level `disableBuiltins` value (true or false)
 * suppresses the user bulk, and `disableThinking` strips the builtin's thinking
 * unless the applied override set one.
 */
function applyBuiltinLadder(
  row: AgentCatalogAgent,
  defaults: CatalogSettings,
  userSettings: CatalogSettings,
  projectSettings: CatalogSettings,
): AgentCatalogAgent {
  const next = applyDefaults(row, defaults);
  const projectOverride = projectSettings.overrides[row.name];
  const userOverride = userSettings.overrides[row.name];
  const projectThinkingConfigured = projectSettings.disableThinking !== undefined;
  const disableThinking = projectThinkingConfigured ? projectSettings.disableThinking === true : userSettings.disableThinking === true;
  if (projectOverride) {
    return clearBuiltinThinking(applyOverride(next, projectOverride, "project"), disableThinking, projectOverride.thinking !== undefined);
  }
  if (projectSettings.disableBuiltins === true) {
    return clearBuiltinThinking({ ...next, disabled: true, disabledSource: { scope: "project", via: "bulk" } }, disableThinking, false);
  }
  if (userOverride) {
    return clearBuiltinThinking(applyOverride(next, userOverride, "user"), disableThinking, !projectThinkingConfigured && userOverride.thinking !== undefined);
  }
  if (projectSettings.disableBuiltins === undefined && userSettings.disableBuiltins === true) {
    return clearBuiltinThinking({ ...next, disabled: true, disabledSource: { scope: "user", via: "bulk" } }, disableThinking, false);
  }
  return clearBuiltinThinking(next, disableThinking, false);
}

/**
 * Every agent definition visible for `cwd`, including rows shadowed by a
 * higher-precedence source. Never throws: missing directories, a missing
 * `pi-subagents` install, unreadable files and malformed settings all mean
 * "no entry".
 */
export function listAgentCatalog(cwd: string): AgentCatalogAgent[] {
  const dir = agentDir();
  const userSettings = readSubagentSettings(dir ? join(dir, "settings.json") : "");
  const project = projectAgentDirs(cwd);
  const projectSettings = readSubagentSettings(join(project.root, CONFIG_DIR_NAME, "settings.json"));
  const { dirs: packageDirs, builtinDirs } = packageAgentDirs(cwd, project.root);

  const sources: Array<{ source: AgentCatalogSource; dirs: string[] }> = [
    { source: "builtin", dirs: builtinDirs },
    { source: "package", dirs: packageDirs },
    { source: "user", dirs: userAgentDirs(userSettings) },
    { source: "project", dirs: project.dirs },
  ];

  const effectiveDefaults: CatalogSettings = {
    overrides: {},
    defaultModel: projectSettings.defaultModel ?? userSettings.defaultModel,
    defaultProvider: projectSettings.defaultProvider ?? userSettings.defaultProvider,
    defaultThinking: projectSettings.defaultThinking ?? userSettings.defaultThinking,
    agentScanDirs: [],
  };

  const scored: Array<{ row: AgentCatalogAgent; rank: number }> = [];
  for (const { source, dirs } of sources) {
    const rows = dirs.flatMap((agentDirPath) => readAgentDir(agentDirPath, source));
    // Built-ins and packages are first-wins across directories, user and project last-wins.
    const ordered = source === "package" ? [...rows].reverse() : rows;
    const seenPaths = new Set<string>();
    ordered.forEach((row, index) => {
      if (seenPaths.has(row.filePath)) return;
      seenPaths.add(row.filePath);
      let next: AgentCatalogAgent;
      if (source === "builtin") {
        next = applyBuiltinLadder(row, effectiveDefaults, userSettings, projectSettings);
      } else {
        // A custom definition applies user then project (project wins), and a
        // custom override never triggers the built-in bulk-disable rules. The
        // two calls keep each scope's disable provenance distinguishable.
        next = applyDefaults(row, effectiveDefaults);
        if (userSettings.overrides[row.name]) next = applyOverride(next, userSettings.overrides[row.name], "user");
        if (projectSettings.overrides[row.name]) next = applyOverride(next, projectSettings.overrides[row.name], "project");
      }
      scored.push({ row: next, rank: SOURCE_RANK[source] * 1_000_000 + index });
    });
  }

  // Per name: the highest-precedence entry wins, and every other row of that
  // name reports which source shadowed it. Same-source collisions (two packages
  // or two user dirs defining one name) count too, so the comparison is by the
  // winning rank, not by the source id.
  const winners = new Map<string, { rank: number; row: AgentCatalogAgent }>();
  for (const { row, rank } of scored) {
    const current = winners.get(row.name);
    if (!current || rank > current.rank) winners.set(row.name, { rank, row });
  }

  return scored
    .map(({ row, rank }) => {
      const winner = winners.get(row.name);
      if (!winner || winner.rank === rank) return row;
      // A shadowed row is display-only; the winner's effective state is what
      // the runtime dispatches, so project both the disable flag and its reason
      // and never leave the panel reading a loser's stale provenance.
      return {
        ...row,
        overriddenBy: winner.row.source,
        disabled: winner.row.disabled,
        disabledSource: winner.row.disabledSource,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
}
