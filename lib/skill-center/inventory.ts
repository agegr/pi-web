import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { DefaultPackageManager, SettingsManager, getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../file-access";
import { samePath, toNativePath } from "../paths";
import { getProjectTrustStatus } from "../project-trust";
import { readSkillInstallInfo, getGlobalSkillsLockPath } from "../skill-lock";
import type { SkillInstallInfo } from "../api-types";
import { canonicalId, classification, readCatalog } from "./catalog";
import { requireValue } from "./errors";
import type { Diagnostic, Installation, Inventory, VersionIdentity } from "./types";
import { discoverAuthorized } from "./discovery";
import { personalClassification } from "./classification-store";
import { nativeRecord } from "./native-install";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function pathId(path: string) { return digest(process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path)); }
export function fileRevision(path: string) {
  const hash = createHash("sha256"); const fd = openSync(path, "r"); const buffer = Buffer.alloc(65536);
  try { let bytes: number; while ((bytes = readSync(fd,buffer,0,buffer.length,null)) > 0) hash.update(buffer.subarray(0,bytes)); }
  finally { closeSync(fd); }
  return hash.digest("hex");
}
export async function resolveContext(value: unknown) {
  requireValue(value === null || typeof value === "string" && value.trim(), "INVALID_INPUT", "cwd 必须为路径或 null。");
  const cwd = value === null ? null : toNativePath(value);
  const agentDir = getAgentDir();
  const roots = await getAllowedFileRoots();
  if (cwd) requireValue(isExistingFilePathAllowed(cwd, roots) && statSync(cwd).isDirectory(), "FORBIDDEN_PATH", "项目路径已失效或没有访问权限。", 403);
  const trusted = cwd ? getProjectTrustStatus(cwd, agentDir).trusted : false;
  const contextId = cwd ? pathId(realpathSync(cwd)) : "global";
  return { cwd, agentDir, roots, trusted, contextId };
}
export function installVersion(install: SkillInstallInfo): VersionIdentity | null {
  const contentHash = install.scope === "project" || /^[a-f0-9]{64}$/i.test(install.versionHash ?? "");
  return install.versionHash ? { value: install.versionHash, kind: contentHash ? "skills-content-hash" : "git-tree", label: contentHash ? "技能内容哈希" : "Git 目录哈希" } : null;
}
function diag(code: string, message: string, paths: string[] = []): Diagnostic {
  return { id: digest(code + message + paths.join("|")), code, severity: "warning", message, paths, installationIds: [], rawDetail: null };
}
export async function inventory(cwdValue: unknown): Promise<Inventory> {
  const ctx = await resolveContext(cwdValue);
  // This resolver skips missing packages and never imports extensions.
  const sdkCwd = ctx.cwd ?? ctx.agentDir;
  const settingsManager = SettingsManager.create(sdkCwd, ctx.agentDir, { projectTrusted: ctx.trusted });
  const diagnostics: Diagnostic[] = [];
  const manager = new DefaultPackageManager({ cwd: sdkCwd, agentDir: ctx.agentDir, settingsManager });
  const resources = await manager.resolve(async source => { diagnostics.push(diag("MISSING_PACKAGE", `已配置的软件包未安装：${source}`)); return "skip"; });
  for (const error of settingsManager.drainErrors()) diagnostics.push(diag("SETTINGS_ERROR", `技能配置读取失败：${error.error.message}`));
  const globalManagementRoots = [join(ctx.agentDir,"skills"),join(homedir(),".pi","agent","skills"),join(homedir(),".agents","skills"),join(process.env.HOME || homedir(),".agents","skills")];
  const roots = new Set([ctx.agentDir, ...globalManagementRoots]);
  if (ctx.cwd && ctx.trusted) roots.add(ctx.cwd);
  // Explicit server-side settings/package paths are part of the configured scope.
  for (const r of resources.skills) {
    if (r.metadata.source !== "auto") roots.add(existsSync(r.path) && statSync(r.path).isFile() ? dirname(r.path) : r.path);
  }
  const readableRoots = resources.skills.filter(r => {
    if (isExistingFilePathAllowed(r.path, roots)) return true;
    diagnostics.push(diag("UNREADABLE_RESOURCE", "配置中的技能无法读取或链接越界。", isFilePathAllowed(r.path, roots) ? [r.path] : []));
    return false;
  });
  const readable = readableRoots.flatMap(r => discoverAuthorized(r.path, roots, message => diagnostics.push(diag("UNREADABLE_RESOURCE",message))).map(path => ({...r,path})));
  const active = loadSkills({ cwd: sdkCwd, agentDir: ctx.agentDir, skillPaths: readable.filter(r => r.enabled).map(r => r.path), includeDefaults: false });
  // The SDK deduplicates physical paths. Inventory must retain each logical management alias.
  const physical: {path:string;enabled:boolean}[] = [...readable];
  const managementRoots = [...globalManagementRoots, ...(ctx.cwd && ctx.trusted ? [join(ctx.cwd,".pi","skills"),join(ctx.cwd,".agents","skills")] : [])];
  for (const root of managementRoots) if (existsSync(root)) {
    for (const path of discoverAuthorized(root,roots,message => diagnostics.push(diag("UNREADABLE_RESOURCE",message)))) {
      if (!physical.some(r=>samePath(r.path,path))) physical.push({path,enabled:false});
    }
  }
  for (const d of active.diagnostics) diagnostics.push(diag(d.type, d.message, d.path && isExistingFilePathAllowed(d.path, roots) ? [d.path] : []));
  const { catalog, diagnostics: catalogDiagnostics } = (() => {
    try { return readCatalog(); } catch { return { catalog: null, diagnostics: [diag("TAXONOMY_UNAVAILABLE", "分类配置不可用，本地清单仍可管理。") ] }; }
  })();
  diagnostics.push(...catalogDiagnostics);
  const locks = [{ scope: "global", path: getGlobalSkillsLockPath() }, ...(ctx.cwd && ctx.trusted ? [{ scope: "project", path: join(ctx.cwd, "skills-lock.json") }] : [])];
  for (const lock of locks) {
    if (!existsSync(lock.path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(lock.path, "utf8"));
      if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) throw new Error();
      for (const name of Object.keys(parsed.skills)) {
        const base = lock.scope === "global" ? join(ctx.agentDir, "skills") : join(ctx.cwd!, ".pi", "skills");
        const shared = lock.scope === "global" ? join(homedir(), ".agents", "skills") : join(ctx.cwd!, ".agents", "skills");
        const folder = name.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "").slice(0, 255);
        if (!existsSync(join(base, folder, "SKILL.md")) && !existsSync(join(shared, folder, "SKILL.md"))) diagnostics.push(diag("MISSING_LOCK_TARGET", `管理记录 ${name} 没有可读取的安装文件。`, [lock.path]));
      }
    } catch { diagnostics.push(diag("INVALID_LOCK", "技能锁文件损坏；其他可读取实例仍可管理。", [lock.path])); }
  }
  const instances = new Map<string, Installation>();
  for (const resource of physical) {
    const found = loadSkills({ cwd: sdkCwd, agentDir: ctx.agentDir, skillPaths: [resource.path], includeDefaults: false });
    if (!found.skills.length && isExistingFilePathAllowed(resource.path, roots)) {
      const realPath = realpathSync(resource.path); const installationId = pathId(realPath);
      if (!instances.has(installationId)) instances.set(installationId, {
        installationId, name: basename(dirname(resource.path)), description: null, canonicalSkillId: null,
        classification: catalog ? classification(null,catalog) : {state:"unclassified",assignments:[],taxonomyVersion:"unavailable",indexRevision:"unavailable"},
        scope: "other", contextId: null, source: null, managed: false, package: null, logicalPath: resource.path, realPath,
        aliases: [{path:resource.path,scope:"other",contextId:null,bindingId:null}], managementBindings: [], managementBindingId:null,
        revision:fileRevision(realPath), installedVersion:null, disableModelInvocation:null, loadState:"invalid", loadReason:"技能文件解析失败，请查看诊断。",
        capabilities:{readContent:true,setVisibility:false,checkUpdate:false,update:false,reasonByCapability:{setVisibility:"技能文件无法解析。",update:"技能文件无法解析。"}},
      });
    }
    for (const d of found.diagnostics) if (!active.diagnostics.some(a => a.message === d.message && a.path === d.path)) diagnostics.push(diag(d.type, d.message, d.path && isExistingFilePathAllowed(d.path, roots) ? [d.path] : []));
    for (const parsedSkill of found.skills) {
      const skill = { ...parsedSkill, filePath: resource.path, baseDir: dirname(resource.path) };
      if (!isExistingFilePathAllowed(skill.filePath, roots)) { diagnostics.push(diag("FORBIDDEN_PATH", "技能文件链接越出授权范围。")); continue; }
      const realPath = realpathSync(skill.filePath);
      const id = pathId(realPath);
      const globalRoots = new Set(globalManagementRoots);
      const projectRoots = new Set(ctx.cwd ? [join(ctx.cwd, ".pi", "skills"), join(ctx.cwd, ".agents", "skills")] : []);
      const scope = isFilePathAllowed(skill.filePath, globalRoots) ? "global" : isFilePathAllowed(skill.filePath, projectRoots) ? "project" : "other";
      const native = nativeRecord(skill.filePath);
      const nativeBinding = native && native.name === skill.name && native.scope === scope && native.contextId === (scope === "project" ? ctx.contextId : null) ? native : null;
      const install = scope === "other" || nativeBinding ? undefined : readSkillInstallInfo(scope === "global" ? getGlobalSkillsLockPath() : join(ctx.cwd!, "skills-lock.json"), skill.name, scope);
      const binding = nativeBinding ? { bindingId: digest(`native:${id}:${nativeBinding.canonical}`), scope: nativeBinding.scope, contextId: nativeBinding.contextId, package: nativeBinding.canonical, source: nativeBinding.source, sourceType: "native-bundle", skillPath: null, ref: null, version: nativeBinding.version, canCheckForUpdates: true } : install ? { bindingId: digest(`${scope}:${scope === "project" ? ctx.contextId : "global"}:${install.package}`), scope: install.scope, contextId: install.scope === "project" ? ctx.contextId : null, package: install.package, source: install.source, sourceType: install.sourceType ?? null, skillPath: install.skillPath ?? null, ref: install.ref ?? null, version: installVersion(install), canCheckForUpdates: install.canCheckForUpdates } : null;
      let canonical: string | null = nativeBinding?.canonical ?? null;
      if (install?.sourceType === "github") { try { canonical = canonicalId(install.package); } catch { /* Untracked identity stays unknown. */ } }
      const alias: Installation["aliases"][number] = { path: skill.filePath, scope, contextId: scope === "project" ? ctx.contextId : null, bindingId: binding?.bindingId ?? null };
      let item = instances.get(id);
      if (!item) {
        const effective = active.skills.some(s => samePath(realpathSync(s.filePath), realPath));
        const collision = active.diagnostics.find(d => d.collision && samePath(d.collision.loserPath, skill.filePath));
        item = { installationId: id, canonicalSkillId: canonical, classification: catalog ? classification(canonical, catalog) : { state: "unclassified", assignments: [], taxonomyVersion: "unavailable", indexRevision: "unavailable" }, name: skill.name, description: skill.description || null, scope, contextId: alias.contextId, source: install?.source ?? null, managed: Boolean(install), package: install?.package ?? null, logicalPath: skill.filePath, realPath, aliases: [], managementBindings: [], managementBindingId: null, revision: fileRevision(realPath), installedVersion: null, disableModelInvocation: skill.disableModelInvocation, loadState: effective ? "effective" : collision ? "shadowed" : !resource.enabled ? "excluded" : "unknown", loadReason: collision?.message ?? (!resource.enabled ? "当前配置排除此资源。" : null), capabilities: { readContent: true, setVisibility: basename(realPath).toLowerCase() === "skill.md", checkUpdate: false, update: false, reasonByCapability: {} } };
        instances.set(id, item);
      }
      if (!item.aliases.some(a => samePath(a.path, alias.path))) item.aliases.push(alias);
      if (binding && !item.managementBindings.some(b => b.bindingId === binding.bindingId)) item.managementBindings.push(binding);
    }
  }
  for (const item of instances.values()) {
    if (new Set(item.aliases.map(a => a.scope)).size > 1) item.scope = "shared";
    const bindings = item.managementBindings;
    item.managed = bindings.length > 0;
    const unique = bindings.length === 1 ? bindings[0] : null;
    item.managementBindingId = unique?.bindingId ?? null;
    item.installedVersion = unique?.version ?? null;
    if (bindings.length && new Set(bindings.map(b=>b.package)).size === 1) {
      item.package = bindings[0].package; item.source = bindings[0].source;
      try { item.canonicalSkillId = bindings[0].sourceType === "native-bundle" ? bindings[0].package : canonicalId(item.package); } catch { item.canonicalSkillId = null; }
      if (catalog) item.classification = classification(item.canonicalSkillId,catalog);
    }
    item.capabilities.checkUpdate = item.capabilities.update = Boolean(unique?.canCheckForUpdates);
    if (!item.capabilities.update) item.capabilities.reasonByCapability.update = bindings.length > 1 ? "共享目录有多个管理记录，无法唯一确定更新来源。" : "缺少受支持的管理记录或可比较版本。";
    if (new Set(bindings.map(b => b.package)).size > 1) { item.source = item.package = item.canonicalSkillId = null; if (catalog) item.classification = classification(null, catalog); }
  }
  const installations = [...instances.values()].map(item => ({ ...item, classification: personalClassification(item.canonicalSkillId ?? `instance:${item.installationId}`, item.classification) }));
  return { taxonomyVersion: catalog?.taxonomy.version ?? "unavailable", indexRevision: catalog?.taxonomy.indexRevision ?? "unavailable", contextId: ctx.contextId, revision: digest(installations.map(i => `${i.installationId}:${i.revision}:${i.loadState}`).join("|")), readAt: new Date().toISOString(), projectResourcesLoaded: Boolean(ctx.cwd && ctx.trusted), installations, diagnostics, coverage: { global: diagnostics.some(d => !d.code.includes("TAXONOMY")) ? "partial" : "complete", project: !ctx.cwd ? "none" : !ctx.trusted ? "untrusted" : diagnostics.length ? "partial" : "complete", description: "当前项目与全局的可访问技能；仅覆盖已授权配置范围，不扫描整机。" } };
}
export async function getInstallation(cwd: unknown, id: string) {
  const list = await inventory(cwd);
  const item = list.installations.find(i => i.installationId === id);
  requireValue(item, "INSTALLATION_NOT_FOUND", "安装实例已不存在或无法访问，请刷新。", 404);
  return item;
}
export function bindingInstall(item: Installation): SkillInstallInfo {
  const b = item.managementBindings.find(b => b.bindingId === item.managementBindingId);
  requireValue(b, "AMBIGUOUS_MANAGEMENT_BINDING", item.capabilities.reasonByCapability.update ?? "没有唯一管理来源。", 422);
  return { package: b.package, scope: b.scope, source: b.source, sourceType: b.sourceType ?? undefined, skillPath: b.skillPath ?? undefined, ref: b.ref ?? undefined, versionHash: b.version?.value, canCheckForUpdates: b.canCheckForUpdates };
}
