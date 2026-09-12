import { randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { runNpx } from "../npx";
import { setDisableModelInvocation } from "../skill-frontmatter";
import { buildSkillUpdateArgs, checkSkillUpdate } from "../skill-updates";
import { isExistingFilePathAllowed } from "../file-access";
import { samePath } from "../paths";
import { getGlobalSkillsLockPath } from "../skill-lock";
import { getSkillCenterConfig } from "./config";
import { errorBody, requireValue, CenterError } from "./errors";
import { bindingInstall, digest, fileRevision, getInstallation, inventory, resolveContext } from "./inventory";
import { detail, sourceSkill } from "./remote";
import { packageFromId, readCatalog } from "./catalog";
import { savePersonalClassification, validateAssignments } from "./classification-store";
import { localTree } from "./files";
import { acquireLease, isProcessAlive, leaseRecord, readJson, releaseDeadLease, saveJson, stateDir } from "./journal";
import { isNativeSkillId, nativeSkillBundle } from "./providers";
import { nativeFileBytes, nativeTarget, nativeTree, validateNativeBundle, writeNativeBundle, type NativeBundle } from "./native-install";
import type { CheckResult, Installation, Operation, Plan, PlanRequest } from "./types";

interface StoredPlan { inventoryRevision: string; plan: Plan; request: PlanRequest; args: string[]; targetRoot: string; canonical: string; fingerprint: string; hidden: boolean | null; targetPhysical: string; sharedTarget: string | null; sharedPhysical: string | null; beforeTree: Record<string,string | undefined> | null; bindings: string; nativeBundle?: NativeBundle }
interface StoredOperation { operation: Operation; plan: StoredPlan; key: string; payload: string; pid: number; childPid?: number; processTreeUnconfirmed?: boolean }
const now = () => new Date().toISOString();
const planFile = (id: string) => join(stateDir(), `plan-${validId(id)}.json`);
const opFile = (id: string) => join(stateDir(), `operation-${validId(id)}.json`);
function validId(id: string) { requireValue(typeof id === "string" && /^[a-f0-9-]{36}$/.test(id), "INVALID_INPUT", "无效操作或计划标识。"); return id; }
function fingerprint() { return digest(JSON.stringify({ config: getSkillCenterConfig(), agentDir: getAgentDir(), home: homedir(), xdg: process.env.XDG_STATE_HOME })); }
function baselineFile(id: string) { return join(stateDir(), `baseline-${id}.json`); }
function baseline(item: Installation) {
  const tree = localTree(dirname(item.realPath));
  return tree.complete ? Object.fromEntries(tree.files.filter(f => f.kind === "file").map(f => [f.path, f.revision])) : null;
}
function localChanges(item: Installation): Plan["localChanges"] {
  const previous = readJson<Record<string, string>>(baselineFile(item.installationId));
  const current = baseline(item);
  return !previous || !current ? "unknown" : JSON.stringify(previous) === JSON.stringify(current) ? "none" : "detected";
}
function checkWritableTarget(path: string, roots: Set<string>) {
  let ancestor = path;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  requireValue(isExistingFilePathAllowed(ancestor, roots), "FORBIDDEN_PATH", "目标目录或链接不在授权范围内。", 403);
  try { accessSync(ancestor, constants.W_OK); } catch { throw new CenterError(403, "FORBIDDEN_PATH", "目标目录不可写。"); }
}
function prospectivePath(path: string): string {
  const tail: string[] = []; let parent = path;
  while (!existsSync(parent) && dirname(parent) !== parent) { tail.unshift(basename(parent)); parent = dirname(parent); }
  return join(realpathSync(parent), ...tail);
}
function cliTargets(scope: "global" | "project", cwd: string | null, name: string) {
  const folder = name.toLowerCase().replace(/[^a-z0-9._]+/g,"-").replace(/^[.\-]+|[.\-]+$/g,"").slice(0,255) || "unnamed-skill";
  const base = scope === "global" ? homedir() : cwd!;
  return { target: join(base,".pi",...(scope === "global" ? ["agent"] : []),"skills",folder,"SKILL.md"), shared: join(base,".agents","skills",folder,"SKILL.md") };
}
function replaceSkill(path: string, expectedRevision: string, text: string) {
  const actual = realpathSync(path); const temporary = join(dirname(actual),`.pi-skill-${randomUUID()}.tmp`);
  const fd = openSync(temporary,"wx",statSync(actual).mode);
  try { writeFileSync(fd,text,"utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  try { requireValue(samePath(realpathSync(path),actual) && fileRevision(actual) === expectedRevision,"REVISION_CONFLICT","文件已被外部修改，请重新读取。",409); renameSync(temporary,actual); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export async function createPlan(request: PlanRequest, persist = true, ownLease = false): Promise<StoredPlan> {
  const ctx = await resolveContext(request.cwd);
  const list = await inventory(request.cwd);
  let item: Installation | null = null;
  let scope: "global" | "project"; let name: string; let source: string; let target: string; let canonical: string; let args: string[];
  let observed: Plan["observedSourceVersion"] = null;
  let sharedTarget: string | null = null;
  let nativeBundle: NativeBundle | undefined;
  const blockers: Plan["blockers"] = [];
  let changes: Plan["localChanges"] = "not-applicable";
  if (request.kind === "update") {
    item = list.installations.find(i => i.installationId === request.installationId) ?? null;
    requireValue(item, "INSTALLATION_NOT_FOUND", "安装实例不存在。", 404);
    requireValue(item.revision === request.expectedRevision, "REVISION_CONFLICT", "技能内容已变化，请重新读取。", 409);
    const install = bindingInstall(item);
    scope = install.scope; name = item.name; source = install.source; canonical = item.canonicalSkillId!;
    requireValue(canonical && item.capabilities.update, "UNSUPPORTED_SOURCE", item.capabilities.reasonByCapability.update ?? "不支持更新此来源。", 422);
    if (isNativeSkillId(canonical)) {
      nativeBundle = validateNativeBundle(await nativeSkillBundle(canonical));
      target = nativeTarget(scope, ctx.cwd, item.name); args = [];
      requireValue(nativeBundle.skill.name === item.name, "IDENTITY_CHANGED", "来源技能名称已变化，不能覆盖原安装。", 409);
    } else {
      const targets = cliTargets(scope,ctx.cwd,packageFromId(canonical).split("@")[1]);
      target = targets.target; sharedTarget = targets.shared; args = buildSkillUpdateArgs(install);
    }
    requireValue(item.aliases.some(a=>samePath(a.path,target)),"UNSUPPORTED_TARGET",nativeBundle ? "此实例不在原生安装位置，不能覆盖更新。" : "此实例位置与 CLI 的 Pi 写入位置不同，不能通过该命令更新。",422);
    changes = localChanges(item);
    if (nativeBundle) {
      try { nativeTree(dirname(item.realPath)); }
      catch (error) { blockers.push({ code: "INCOMPLETE_LOCAL_TREE", message: errorBody(error).error.message }); }
    }
    if (changes === "detected") blockers.push({ code: "LOCAL_CHANGES", message: "检测到本地编辑，请先自行保存或处理后重试。" });
    if (!ownLease) {
      const check = nativeBundle ? { state: nativeBundle.version.value === item.installedVersion?.value ? "up-to-date" : "update-available", latestVersion: nativeBundle.version.value, message: undefined } : await checkSkillUpdate(install);
      if (check.state !== "update-available") blockers.push({ code: "NO_CONFIRMED_UPDATE", message: check.message ?? "尚未确认可用更新，请先检查。" });
      if (check.latestVersion && item.installedVersion) observed = { ...item.installedVersion, value: check.latestVersion };
    }
  } else {
    requireValue(request.scope === "global" || request.scope === "project", "INVALID_SCOPE", "请选择项目或全局安装范围。");
    scope = request.scope;
    if (isNativeSkillId(request.canonicalSkillId)) nativeBundle = validateNativeBundle(await nativeSkillBundle(request.canonicalSkillId));
    const skill = nativeBundle?.skill ?? sourceSkill(packageFromId(request.canonicalSkillId));
    canonical = skill.canonicalSkillId; source = skill.source; name = skill.name;
    requireValue(scope !== "project" || ctx.cwd, "INVALID_SCOPE", "项目安装需要选择项目。");
    // skills CLI Pi adapter: .pi/skills and HOME/.pi/agent/skills; shared store is .agents/skills.
    const targets = cliTargets(scope,ctx.cwd,name);
    target = nativeBundle ? nativeTarget(scope, ctx.cwd, name) : targets.target;
    const shared = targets.shared;
    sharedTarget = nativeBundle ? null : shared;
    if (existsSync(nativeBundle ? dirname(target) : target) || existsSync(shared)) blockers.push({ code: "TARGET_CONFLICT", message: "安装目标或共享位置已存在，请到已安装页面管理，不能覆盖安装。" });
    if (list.installations.some(i => i.canonicalSkillId === canonical && i.aliases.some(a => a.scope === scope))) blockers.push({ code: "ALREADY_INSTALLED", message: "该范围已有此技能，请到已安装页面管理。" });
    // Metadata resolution verifies the CLI's named skill before allowing the write.
    if (nativeBundle) observed = nativeBundle.version;
    else if (!ownLease) { const info = await detail({ kind: "remote", canonicalSkillId: canonical }); observed = info.version; }
    args = nativeBundle ? [] : ["skills", "add", source, "--skill", name, "-y", "--agent", "pi", ...(scope === "global" ? ["-g"] : [])];
  }
  if (scope === "project") requireValue(ctx.cwd && ctx.trusted, "PROJECT_UNTRUSTED", "项目资源尚未信任，请先通过现有信任流程授权。", 403);
  const roots = new Set([scope === "global" ? nativeBundle ? ctx.agentDir : homedir() : ctx.cwd!]);
  checkWritableTarget(dirname(target), roots);
  if (sharedTarget) checkWritableTarget(dirname(sharedTarget), roots);
  const lockTarget = nativeBundle ? stateDir() : scope === "global" ? getGlobalSkillsLockPath() : join(ctx.cwd!,"skills-lock.json");
  const lockRoots = new Set([...roots,...(nativeBundle ? [ctx.agentDir] : []),...(scope === "global" && process.env.XDG_STATE_HOME ? [process.env.XDG_STATE_HOME] : [])]);
  checkWritableTarget(existsSync(lockTarget) ? lockTarget : dirname(lockTarget),lockRoots);
  if (!ownLease && leaseRecord()) blockers.push({ code: "BUSY", message: "另一个技能写入操作正在运行或等待核验。" });
  const aliases = [...new Set([...(item?.aliases.map(a => a.path) ?? []),...(sharedTarget ? [sharedTarget] : [])])];
  const shared = item ? item.aliases.length > 1 || !samePath(item.logicalPath, item.realPath) : false;
  const requiresProjectTrust = scope === "project" && new ProjectTrustStore(ctx.agentDir).get(ctx.cwd!) !== true;
  const plan: Plan = { planId: randomUUID(), operationId: randomUUID(), classification: item?.classification ?? nativeBundle?.skill.classification ?? sourceSkill(packageFromId(canonical)).classification, kind: request.kind, state: blockers.length ? "blocked" : "ready", expiresAt: new Date(Date.now() + getSkillCenterConfig().planTtlMs).toISOString(), contextId: ctx.contextId, scope, skillName: name, source, target: { logicalPath: target, realPath: existsSync(target) ? realpathSync(target) : null, sharedAliases: aliases }, currentVersion: item?.installedVersion ?? null, observedSourceVersion: observed, sourceVersionPinned: Boolean(nativeBundle), localChanges: changes, expectedRevision: item?.revision ?? null, requiredAcknowledgements: [...(changes === "unknown" ? ["overwrite-unknown-local-changes" as const] : []), ...(shared ? ["affects-shared-file" as const] : [])], blockers, notices: [nativeBundle ? "安装已预览的完整文件包，不执行其中的脚本。" : "将安装执行时源站可用内容；此预览不固定版本。", "已写入的技能将在下次资源加载时按当前配置处理。", ...(!nativeBundle && scope === "global" && !samePath(getAgentDir(), join(homedir(), ".pi", "agent")) ? ["当前 Agent 使用自定义配置目录；CLI 的全局 Pi 位置可能不会被当前配置加载。"] : [])] };
  if (requiresProjectTrust) plan.requiredAcknowledgements.push("trust-project-resources");
  const stored: StoredPlan = { inventoryRevision: list.revision, plan, request, args, targetRoot: dirname(target), canonical, fingerprint: fingerprint(), hidden: item?.disableModelInvocation ?? null, targetPhysical: prospectivePath(target), sharedTarget, sharedPhysical: sharedTarget ? prospectivePath(sharedTarget) : null, beforeTree: item ? baseline(item) : null, bindings: JSON.stringify(item?.managementBindings ?? []), ...(nativeBundle ? { nativeBundle } : {}) };
  if (persist) saveJson(planFile(plan.planId), stored);
  return stored;
}
export async function checks(cwd: unknown, ids?: unknown): Promise<{ results: CheckResult[]; checkedAt: string; diagnostics: [] }> {
  requireValue(ids === undefined || Array.isArray(ids) && ids.every(id => typeof id === "string"), "INVALID_INPUT", "installationIds 必须是字符串数组。");
  const list = await inventory(cwd);
  if (ids) requireValue((ids as string[]).every(id => list.installations.some(i => i.installationId === id)), "INSTALLATION_NOT_FOUND", "部分安装实例不可访问，请刷新。", 404);
  const selected = list.installations.filter(i => ids === undefined || (ids as string[]).includes(i.installationId));
  const results: CheckResult[] = [];
  for (const item of selected) {
    let result: CheckResult = { installationId: item.installationId, basedOnRevision: item.revision, state: "unsupported", currentVersion: item.installedVersion, sourceVersion: null, checkedAt: now(), stale: false, reasonCode: "UNSUPPORTED_SOURCE", message: item.capabilities.reasonByCapability.update ?? null };
    if (item.capabilities.checkUpdate) {
      if (item.canonicalSkillId && isNativeSkillId(item.canonicalSkillId)) {
        try {
          const bundle = await nativeSkillBundle(item.canonicalSkillId, true);
          result = { ...result, state: bundle.version.value === item.installedVersion?.value ? "up-to-date" : "update-available", sourceVersion: bundle.version, message: null, reasonCode: null, checkedAt: now() };
        } catch (error) { result = { ...result, state: "error", message: errorBody(error).error.message, reasonCode: "SOURCE_UNAVAILABLE", checkedAt: now() }; }
      } else {
        const check = await checkSkillUpdate(bindingInstall(item));
        result = { ...result, state: check.state, sourceVersion: check.latestVersion && item.installedVersion ? { ...item.installedVersion, value: check.latestVersion } : null, message: check.message ?? null, reasonCode: check.state === "error" ? "SOURCE_UNAVAILABLE" : null, checkedAt: now() };
      }
    }
    try { result.stale = fileRevision(item.realPath) !== item.revision; } catch { result.stale = true; }
    results.push(result);
  }
  return { results, checkedAt: now(), diagnostics: [] };
}
export async function visibility(id: string, body: Record<string, unknown>) {
  requireValue(typeof body.disableModelInvocation === "boolean" && typeof body.expectedRevision === "string" && (body.acknowledgeSharedFile === undefined || typeof body.acknowledgeSharedFile === "boolean"), "INVALID_INPUT", "可见性和确认字段必须为布尔值，并提供文件版本。");
  const lease = acquireLease(null);
  try {
    const item = await getInstallation(body.cwd, id);
    requireValue(item.capabilities.setVisibility, "INVALID_SKILL", "此文件不能修改展示设置。", 422);
    requireValue(item.revision === body.expectedRevision, "REVISION_CONFLICT", "文件已被修改，请刷新后重试。", 409);
    requireValue(item.aliases.length < 2 || body.acknowledgeSharedFile, "SHARED_FILE", `此修改影响 ${item.aliases.length} 个访问入口，请确认共享影响。`, 409);
    const original = readFileSync(item.realPath, "utf8");
    const changed = setDisableModelInvocation(original, body.disableModelInvocation);
    const beforeBaseline = readJson<Record<string, string>>(baselineFile(id));
    requireValue(fileRevision(item.realPath) === body.expectedRevision, "REVISION_CONFLICT", "文件已被修改。", 409);
    replaceSkill(item.realPath,item.revision,changed);
    const next = await getInstallation(body.cwd, id);
    requireValue(next.disableModelInvocation === body.disableModelInvocation, "VERIFY_FAILED", "写入结果待确认，请重新读取。", 409);
    // Never bless unrelated local edits as an installation baseline.
    if (beforeBaseline?.[basename(item.realPath)] === digest(original)) {
      beforeBaseline[basename(item.realPath)] = digest(changed); saveJson(baselineFile(id), beforeBaseline);
    }
    return { installation: next, effectiveWhen: "next-resource-load" };
  } finally { lease.release(); }
}
export async function setClassification(id: string, body: Record<string, unknown>) {
  const lease = acquireLease(null);
  try {
    const item = await getInstallation(body.cwd, id);
    requireValue(typeof body.expectedRevision === "string" && item.revision === body.expectedRevision, "REVISION_CONFLICT", "技能文件已变化，请刷新后重试。", 409);
    const { catalog, diagnostics } = readCatalog();
    requireValue(!diagnostics.length && body.taxonomyVersion === catalog.taxonomy.version && body.indexRevision === catalog.taxonomy.indexRevision, "TAXONOMY_CHANGED", "领域目录已变化或不可用，请刷新后重试。", 409);
    requireValue(body.reset === undefined || typeof body.reset === "boolean", "INVALID_INPUT", "恢复分类参数无效。");
    const assignments = validateAssignments(body.assignments, catalog.taxonomy);
    savePersonalClassification(item.canonicalSkillId ?? `instance:${item.installationId}`, assignments, body.expectedClassificationRevision, body.reset === true);
    return { installation: await getInstallation(body.cwd, id) };
  } finally { lease.release(); }
}
function cleanOutput(value: string) {
  const cleaned = value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@").replace(/(?:gh[pousr]_[\w]+|github_pat_[\w]+|Bearer\s+\S+)/gi, "[redacted]").split(homedir()).join("~");
  const max = getSkillCenterConfig().maxOutputBytes;
  const bytes = Buffer.from(cleaned); return bytes.length > max ? `[日志已截断]\n${bytes.subarray(bytes.length - max).toString("utf8")}` : cleaned;
}
async function verify(record: StoredOperation, restoreVisibility: boolean) {
  const { plan } = record;
  const target = join(plan.targetRoot, "SKILL.md");
  requireValue(existsSync(target), "VERIFY_FAILED", "没有找到预期安装文件，结果待确认。", 409);
  const list = await inventory(plan.request.cwd);
  let item = list.installations.find(i => i.canonicalSkillId === plan.canonical && i.aliases.some(a => samePath(a.path, target)));
  requireValue(item && item.managementBindings.length === 1, "VERIFY_FAILED", "已写入但身份或管理记录尚未核验一致。", 409);
  requireValue(samePath(item.realPath, plan.targetPhysical) || Boolean(plan.sharedPhysical && samePath(item.realPath, plan.sharedPhysical)), "FORBIDDEN_PATH", "安装目标的实际链接位置与预检不一致，停止写入。", 403);
  if (plan.plan.kind === "update") {
    requireValue(item.installedVersion?.value !== plan.plan.currentVersion?.value || plan.beforeTree && JSON.stringify(baseline(item)) !== JSON.stringify(plan.beforeTree), "VERIFY_FAILED", "未观察到预期更新，不能把原有文件视为更新成功。", 409);
    if (restoreVisibility && plan.hidden !== null) {
      const current = fileRevision(item.realPath);
      requireValue(current === item.revision, "REVISION_CONFLICT", "核验期间文件发生变化。", 409);
      const text = readFileSync(item.realPath, "utf8"); replaceSkill(item.realPath,item.revision,setDisableModelInvocation(text, plan.hidden));
      item = await getInstallation(plan.request.cwd, item.installationId);
    }
    requireValue(item.disableModelInvocation === plan.hidden, "VERIFY_FAILED", "模型展示设置尚未恢复一致。", 409);
  }
  const summary = baseline(item);
  if (plan.nativeBundle) {
    requireValue(item.installedVersion?.value === plan.nativeBundle.version.value, "VERIFY_FAILED", "文件包版本与管理记录不一致。", 409);
    const expected = Object.fromEntries(plan.nativeBundle.files.map(file => [file.path, digest(file.path === "SKILL.md" && plan.hidden !== null ? setDisableModelInvocation(file.content, plan.hidden) : nativeFileBytes(file))]));
    const actual = nativeTree(plan.targetRoot);
    requireValue(Object.keys(actual).length === Object.keys(expected).length && Object.entries(actual).every(([path, revision]) => expected[path] === revision), "VERIFY_FAILED", "安装文件与预览文件包不一致。", 409);
  }
  const result = await checks(plan.request.cwd, [item.installationId]);
  const status = result.results[0]?.state;
  const latest = await getInstallation(plan.request.cwd,item.installationId);
  requireValue(!result.results[0]?.stale && latest.revision === item.revision && JSON.stringify(baseline(latest)) === JSON.stringify(summary) && JSON.stringify(latest.managementBindings) === JSON.stringify(item.managementBindings), "REVISION_CONFLICT", "核验期间文件或管理记录发生变化，请重新核验。",409);
  if (summary) saveJson(baselineFile(item.installationId), summary);
  record.operation.result = { installationId: item.installationId, actualVersion: item.installedVersion, visibilityPreserved: plan.plan.kind === "update" ? item.disableModelInvocation === plan.hidden : null, currentSourceStatus: status === "unsupported" ? "unchecked" : status ?? "unchecked", reloadRequired: true };
  record.operation.state = "succeeded"; record.operation.error = null;
}
export async function submitOperation(body: Record<string, unknown>, runner = runNpx) {
  requireValue(typeof body.planId === "string" && typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 200 && Array.isArray(body.acknowledgements) && body.acknowledgements.every(a => typeof a === "string"), "INVALID_INPUT", "无效计划、幂等键或确认字段。");
  const key = digest(body.idempotencyKey); const payload = digest(JSON.stringify([body.planId, [...body.acknowledgements].sort()]));
  const keyPath = join(stateDir(), `key-${key}.json`);
  const existing = readJson<{ operationId: string; payload: string }>(keyPath);
  if (existing) { requireValue(existing.payload === payload, "IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同请求。", 409); return { operation: await getOperation(existing.operationId), duplicate: true }; }
  const stored = readJson<StoredPlan>(planFile(body.planId));
  requireValue(stored && stored.plan.state === "ready" && Date.parse(stored.plan.expiresAt) > Date.now() && stored.fingerprint === fingerprint(), "STALE_PLAN", "安装计划已失效，请重新预检。", 409);
  requireValue(stored.plan.requiredAcknowledgements.every(a => (body.acknowledgements as string[]).includes(a)), "ACKNOWLEDGEMENT_REQUIRED", "请确认当前计划标明的具体影响。", 409);
  const operationId = stored.plan.operationId;
  let lease: ReturnType<typeof acquireLease>;
  try { lease = acquireLease(operationId); }
  catch (error) {
    // A concurrent retry of this same reserved operation waits only for its acceptance record.
    const deadline = Date.now() + getSkillCenterConfig().searchTimeoutMs;
    while (leaseRecord()?.operationId === operationId && !existsSync(keyPath) && Date.now() < deadline) await delay(25);
    const duplicate = readJson<{operationId:string;payload:string}>(keyPath);
    if (duplicate) { requireValue(duplicate.payload === payload,"IDEMPOTENCY_CONFLICT","幂等键冲突。",409); return {operation:await getOperation(duplicate.operationId),duplicate:true}; }
    throw error;
  }
  try {
    // Check again under the cross-process lease for simultaneous identical submissions.
    const duplicate = readJson<{ operationId: string; payload: string }>(keyPath);
    if (duplicate) { requireValue(duplicate.payload === payload, "IDEMPOTENCY_CONFLICT", "幂等键冲突。", 409); lease.release(); return { operation: await getOperation(duplicate.operationId), duplicate: true }; }
    requireValue(!existsSync(opFile(operationId)), "STALE_PLAN", "此计划已用于另一次提交，请查看原操作。", 409);
    const fresh = await createPlan(stored.request, false, true);
    requireValue(fresh.plan.state === "ready" && fresh.inventoryRevision === stored.inventoryRevision && fresh.fingerprint === stored.fingerprint && samePath(fresh.targetPhysical, stored.targetPhysical) && fresh.sharedPhysical === stored.sharedPhysical && fresh.bindings === stored.bindings && fresh.plan.expectedRevision === stored.plan.expectedRevision && fresh.plan.localChanges === stored.plan.localChanges && JSON.stringify(fresh.plan.requiredAcknowledgements) === JSON.stringify(stored.plan.requiredAcknowledgements), "STALE_PLAN", "目标、共享影响或文件状态已变化，请重新预检。", 409);
    const operation: Operation = { operationId, kind: stored.plan.kind, state: "accepted", contextId: stored.plan.contextId, projectLabel: stored.plan.scope === "project" ? stored.request.cwd : null, scope: stored.plan.scope, skillName: stored.plan.skillName, targetPath: stored.plan.target.logicalPath, createdAt: now(), updatedAt: now(), finishedAt: null, result: null, error: null, outputExcerpt: null, pollAfterMs: getSkillCenterConfig().pollAfterMs };
    const record: StoredOperation = { operation, plan: stored, key, payload, pid: process.pid };
    saveJson(opFile(operationId), record); saveJson(keyPath, { operationId, payload });
    void execute(record, lease, runner).catch(() => { /* Keep the durable journal and lease for explicit recovery if persistence fails. */ });
    return { operation: { ...operation }, duplicate: false };
  } catch (error) { lease.release(); throw error; }
}
export async function execute(record: StoredOperation, lease: ReturnType<typeof acquireLease>, runner = runNpx) {
  const op = record.operation;
  let cliError: unknown;
  try {
    op.state = "running"; op.updatedAt = now(); saveJson(opFile(op.operationId), record);
    // A clean project acquires gated resources on its first install. Persist only
    // the explicit trust acknowledgement already validated with the submitted plan.
    if (record.plan.plan.requiredAcknowledgements?.includes("trust-project-resources")) new ProjectTrustStore(getAgentDir()).set(record.plan.request.cwd!, true);
    try {
      if (record.plan.nativeBundle) {
        requireValue(record.plan.nativeBundle.skill.canonicalSkillId === record.plan.canonical && samePath(prospectivePath(join(record.plan.targetRoot, "SKILL.md")), record.plan.targetPhysical), "FORBIDDEN_PATH", "安装身份或目标路径已变化。", 403);
        writeNativeBundle(record.plan.nativeBundle, join(record.plan.targetRoot, "SKILL.md"), op.scope, op.scope === "project" ? op.contextId : null, record.plan.beforeTree, record.plan.hidden);
      } else {
        const output = await runner(record.plan.args, { timeout: getSkillCenterConfig().cliTimeoutMs, terminateTreeOnTimeout: true, cwd: op.scope === "project" ? record.plan.request.cwd! : undefined, env: { ...process.env, FORCE_COLOR: "0" }, onSpawn(pid) { record.childPid = pid; lease.child(pid); saveJson(opFile(op.operationId), record); } });
        op.outputExcerpt = cleanOutput(output.stdout + output.stderr);
      }
    } catch (error) { cliError = error; const e = error as { stdout?: string; stderr?: string }; op.outputExcerpt = cleanOutput((e.stdout ?? "") + (e.stderr ?? "")); }
    const processError = cliError as { killed?: boolean; treeTerminated?: boolean } | undefined;
    record.processTreeUnconfirmed = Boolean(processError?.killed && !processError.treeTerminated);
    requireValue(!processError?.killed || processError.treeTerminated, "PROCESS_UNCONFIRMED", "无法确认技能进程树已停止；保留写入租约，等待人工核验。",409);
    op.state = "verifying"; op.updatedAt = now(); saveJson(opFile(op.operationId), record);
    await verify(record, true);
  } catch (error) {
    op.state = "needs-review"; op.error = errorBody(error).error;
    if (cliError && !existsSync(record.plan.targetRoot) && !(cliError as { killed?: boolean }).killed) op.state = "failed";
  } finally {
    op.updatedAt = now(); op.finishedAt = now(); op.pollAfterMs = null;
    saveJson(opFile(op.operationId), record);
    {
      const error = cliError as { killed?: boolean; treeTerminated?: boolean } | undefined;
      if (!error?.killed || error.treeTerminated) lease.release();
    }
  }
}
export async function getOperation(id: string): Promise<Operation> {
  const record = readJson<StoredOperation>(opFile(id));
  requireValue(record, "OPERATION_NOT_FOUND", "没有找到操作记录；请勿自动重复安装。", 404);
  await resolveContext(record.plan.request.cwd);
  if (["accepted", "running", "verifying"].includes(record.operation.state) && (!isProcessAlive(record.pid) || leaseRecord()?.operationId !== id)) {
    record.processTreeUnconfirmed = Boolean(record.childPid);
    record.operation.state = "needs-review"; record.operation.pollAfterMs = null; record.operation.updatedAt = now();
    record.operation.error = errorBody(new CenterError(409, "INTERRUPTED", "服务已重启，操作结果待核验；不会自动重跑。 ")).error;
    saveJson(opFile(id), record);
  }
  return record.operation;
}
export async function reconcile(id: string) {
  const operation = await getOperation(id);
  requireValue(operation.state === "needs-review", "BUSY", "只能核验待确认的操作。", 409);
  const record = readJson<StoredOperation>(opFile(id))!;
  requireValue(!record.processTreeUnconfirmed,"PROCESS_UNCONFIRMED","进程树状态尚未确认，请先在服务主机核查遗留进程；界面不会自动解除写入保护。",409);
  requireValue(!record.childPid || !isProcessAlive(record.childPid), "BUSY", "技能子进程仍在运行，请等待。", 409);
  const oldLease = leaseRecord();
  if (oldLease) { requireValue(oldLease.operationId === id && !isProcessAlive(oldLease.pid),"BUSY","另一个写入或核验仍在运行。",409); releaseDeadLease(id); }
  const guard = acquireLease(id);
  try {
  try { await verify(record, false); } catch (error) {
    record.operation.error = errorBody(error).error;
    if (!existsSync(record.plan.targetRoot) && (!record.childPid || !isProcessAlive(record.childPid))) record.operation.state = "failed";
  }
  record.operation.updatedAt = now(); record.operation.finishedAt = now(); record.operation.pollAfterMs = null;
  saveJson(opFile(id), record);
  return record.operation;
  } finally { guard.release(); }
}

export async function writeStatus(recover = false) {
  const lease = leaseRecord();
  if (!lease) return { busy: false, operationId: null, recoverable: false };
  const record = lease.operationId ? readJson<StoredOperation>(opFile(lease.operationId)) : null;
  if (record) await resolveContext(record.plan.request.cwd);
  const recoverable = !isProcessAlive(lease.pid) && !lease.childPid && (!record || record.operation.state === "accepted");
  if (recover) {
    requireValue(recoverable, "BUSY", "该租约不能安全释放；请查询原操作并核验结果。", 409);
    if (record) { record.operation.state = "failed"; record.operation.error = errorBody(new CenterError(409,"INTERRUPTED","进程在启动技能命令前中断。请重新预检。")).error; saveJson(opFile(record.operation.operationId),record); }
    releaseDeadLease(lease.operationId);
    return { busy: false, operationId: lease.operationId, recoverable: false };
  }
  return { busy: true, operationId: lease.operationId, recoverable };
}
