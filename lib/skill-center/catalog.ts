import { readFileSync } from "node:fs";
import bundled from "./catalog.json";
import { getSkillCenterConfig } from "./config";
import { CenterError, requireValue } from "./errors";
import { personalClassification } from "./classification-store";
import type { Assignment, Classification, Diagnostic, DomainId, QueryCoverage, SourceSkill, Taxonomy } from "./types";

export interface Catalog { taxonomy: Taxonomy; skills: SourceSkill[]; assignments: Assignment[] }
const domainOrder = ["computing", "finance", "philosophy", "psychology", "metaphysics"];
export function canonicalId(pkg: string): string {
  const match = /^([\w.-]+\/[\w.-]+)@([\w.-]+(?:::[\w.-]+)*)$/.exec(pkg);
  requireValue(match, "INVALID_PACKAGE", "技能来源必须明确到 owner/repo@skill。");
  return `skills.sh:${match[1].toLowerCase()}@${match[2]}`;
}
export function packageFromId(id: string): string {
  requireValue(typeof id === "string" && id.startsWith("skills.sh:"), "INVALID_PACKAGE", "无效来源标识。");
  const pkg = id.slice(10);
  requireValue(canonicalId(pkg) === id, "INVALID_PACKAGE", "来源标识不是规范格式。");
  return pkg;
}
export function validateCatalog(raw: unknown): Catalog {
  requireValue(raw && typeof raw === "object", "INVALID_INDEX", "目录配置必须为对象。");
  const data = raw as Catalog;
  const t = data.taxonomy;
  requireValue(t && typeof t.version === "string" && t.version && typeof t.indexRevision === "string" && t.indexRevision, "INVALID_INDEX", "缺少目录版本。");
  requireValue(Array.isArray(t.domains) && t.domains.length === domainOrder.length, "INVALID_INDEX", "必须配置五个领域。");
  const categories = new Set<string>();
  t.domains.forEach((d, i) => {
    requireValue(d.id === domainOrder[i] && d.order === i + 1 && typeof d.label === "string" && d.label && typeof d.description === "string", "INVALID_INDEX", "领域集合或顺序无效。");
    requireValue(Array.isArray(d.quickQueries) && d.quickQueries.every(q => typeof q === "string") && Array.isArray(d.categories), "INVALID_INDEX", "领域配置无效。");
    d.categories.forEach((c, j) => {
      requireValue(typeof c.id === "string" && /^[a-z][a-z0-9-]*$/.test(c.id) && !categories.has(c.id) && typeof c.label === "string" && c.label && c.order === j + 1, "INVALID_INDEX", "分类重复或顺序无效。");
      categories.add(c.id);
    });
  });
  requireValue(Array.isArray(data.skills) && Array.isArray(data.assignments), "INVALID_INDEX", "缺少条目或归属集合。");
  const skills = new Map<string, SourceSkill>();
  for (const s of data.skills) {
    requireValue(s.canonicalSkillId === canonicalId(s.package) && !skills.has(s.canonicalSkillId) && s.provider === "skills.sh" && typeof s.name === "string" && s.name && typeof s.source === "string" && (s.description === null || typeof s.description === "string"), "INVALID_INDEX", "条目身份重复或字段无效。");
    requireValue(s.source === packageFromId(s.canonicalSkillId).split("@")[0] && s.sourceUrl === `https://github.com/${s.source}`, "INVALID_INDEX", "条目来源不匹配。");
    requireValue(s.name === packageFromId(s.canonicalSkillId).split("@")[1] && s.sourceType === "github" && ["pending","ready","unavailable","ambiguous"].includes(s.metadataState) && (s.directoryUrl === null || s.directoryUrl === `https://skills.sh/${s.source}/${encodeURIComponent(s.name)}`),"INVALID_INDEX","条目名称、内容状态或目录链接不匹配。");
    requireValue(s.installCount === null || (typeof s.installCount?.display === "string" && (s.installCount.numeric === null || Number.isSafeInteger(s.installCount.numeric) && s.installCount.numeric >= 0)), "INVALID_INDEX", "安装量无效。");
    skills.set(s.canonicalSkillId, s);
  }
  const keys = new Set<string>();
  for (const a of data.assignments) {
    const s = skills.get(a.canonicalSkillId);
    const d = t.domains.find(d => d.id === a.domainId);
    const key = JSON.stringify([a.canonicalSkillId, a.domainId, a.categoryId]);
    requireValue(s && d && (a.categoryId === null || d.categories.some(c => c.id === a.categoryId)) && !keys.has(key), "INVALID_INDEX", "归属重复或指向不存在的技能/分类。");
    const e = a.evidence;
    requireValue(e && typeof e.sourceUrl === "string" && (e.sourceUrl === s.sourceUrl || e.sourceUrl.startsWith(`${s.sourceUrl}/`)) && ((typeof e.relativePath === "string" && e.relativePath && !e.relativePath.split(/[\\/]/).includes("..") && !/^(?:[\\/]|\w+:)/.test(e.relativePath)) || (typeof e.excerpt === "string" && e.excerpt.trim())) && typeof e.verifiedAt === "string" && Number.isFinite(Date.parse(e.verifiedAt)), "INVALID_INDEX", "归属缺少匹配来源和可核查证据。");
    keys.add(key);
  }
  return structuredClone(data);
}
declare global { var __piSkillCatalog: { path: string; catalog: Catalog; raw: string } | undefined }
export function readCatalog(): { catalog: Catalog; diagnostics: Diagnostic[] } {
  const path = getSkillCenterConfig().indexPath ?? "bundled";
  try {
    const raw = path === "bundled" ? JSON.stringify(bundled) : readFileSync(path, "utf8");
    const old = globalThis.__piSkillCatalog;
    if (old?.path === path && old.raw === raw) return { catalog: old.catalog, diagnostics: [] };
    const catalog = validateCatalog(JSON.parse(raw));
    if (old?.path === path && old.raw !== raw) requireValue(catalog.taxonomy.indexRevision !== old.catalog.taxonomy.indexRevision, "INVALID_INDEX", "目录内容变化必须更新 indexRevision。");
    globalThis.__piSkillCatalog = { path, catalog, raw };
    return { catalog, diagnostics: [] };
  } catch (error) {
    const old = globalThis.__piSkillCatalog;
    if (!old || old.path !== path) throw new CenterError(503, "TAXONOMY_UNAVAILABLE", "暂时无法读取领域分类，请检查服务端目录配置。");
    return { catalog: old.catalog, diagnostics: [{ id: "index-invalid", code: "INVALID_INDEX", severity: "error", message: error instanceof CenterError ? error.message : "分类配置读取失败，保留上次有效版本。", installationIds: [], paths: [], rawDetail: null }] };
  }
}
export function classification(id: string | null, catalog: Catalog): Classification {
  const assignments = catalog.assignments.filter(a => a.canonicalSkillId === id).map(({ domainId, categoryId }) => ({ domainId, categoryId }));
  const base: Classification = { state: assignments.length ? "classified" : "unclassified", assignments, taxonomyVersion: catalog.taxonomy.version, indexRevision: catalog.taxonomy.indexRevision };
  return id ? personalClassification(id, base) : base;
}
/** Classification failure must not disable independent external search or local content. */
export function optionalCatalog() {
  try { return readCatalog(); } catch (error) {
    if (!(error instanceof CenterError) || error.code !== "TAXONOMY_UNAVAILABLE") throw error;
    return { catalog: { taxonomy: { ...bundled.taxonomy, version: "unavailable", indexRevision: "unavailable" }, skills: [], assignments: [] } as Catalog, diagnostics: [{ id: "taxonomy-unavailable", code: "TAXONOMY_UNAVAILABLE", severity: "error" as const, message: "分类暂不可用，外部结果的领域归属未确认。", installationIds: [], paths: [], rawDetail: null }] };
  }
}
export function parseQuery(body: Record<string, unknown>, catalog: Catalog, external = false) {
  const config = getSkillCenterConfig();
  requireValue(body.query === undefined && !external || typeof body.query === "string", "INVALID_INPUT", "关键词格式无效。");
  const query = (body.query as string | undefined)?.trim() ?? "";
  requireValue((!external || query) && [...query].length <= config.maxQueryLength, "INVALID_INPUT", `请输入 1–${config.maxQueryLength} 个字符。`);
  const domainId = body.domainId ?? null;
  const categoryId = body.categoryId ?? null;
  const domain = catalog.taxonomy.domains.find(d => d.id === domainId);
  requireValue(domainId === null || domain, "INVALID_DOMAIN", "领域不存在。");
  requireValue(categoryId === null || domain?.categories.some(c => c.id === categoryId), "INVALID_CATEGORY", "请选择分类所属的领域。");
  const state = body.classificationState ?? "all";
  requireValue(["all", "classified", "unclassified"].includes(state as string) && !(state === "unclassified" && domainId), "INVALID_INPUT", "待分类不能与具体领域组合。");
  const limit = body.limit === undefined ? config.defaultLimit : body.limit;
  requireValue(typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= config.maxLimit, "INVALID_INPUT", "结果数量超出允许范围。");
  return { query, domainId: domainId as DomainId | null, categoryId: categoryId as string | null, state, limit };
}
export function coverage(catalog: Catalog, total: number | null, returned: number, external = false, truncated = false): QueryCoverage {
  return { kind: external ? "external-result-set" : "local-index", taxonomyVersion: catalog.taxonomy.version, indexRevision: catalog.taxonomy.indexRevision, indexedUnique: catalog.taxonomy.version === "unavailable" ? null : catalog.skills.length, totalMatched: total, returnedCount: returned, truncated, marketTotal: null, completeWithinIndex: external ? null : !truncated, description: external ? "本次外部结果；未对源站全市场完成领域分类。" : "本地已收录目录；领域数量不可相加作为技能总数。" };
}
export function queryCatalog(body: Record<string, unknown>) {
  const { catalog, diagnostics } = readCatalog();
  const q = parseQuery(body, catalog);
  const matches = catalog.skills.map(s => ({ ...s, classification: classification(s.canonicalSkillId, catalog) })).filter(s =>
    [s.name, s.description, s.source].some(v => v?.toLowerCase().includes(q.query.toLowerCase())) &&
    (q.state === "all" || s.classification.state === q.state) &&
    (!q.domainId || s.classification.assignments.some(a => a.domainId === q.domainId && (!q.categoryId || a.categoryId === q.categoryId))));
  const results = matches.slice(0, q.limit);
  return { results, ordering: "index", taxonomyVersion: catalog.taxonomy.version, indexRevision: catalog.taxonomy.indexRevision, coverage: coverage(catalog, matches.length, results.length, false, matches.length > results.length), diagnostics };
}
export function getTaxonomy() {
  const { catalog, diagnostics } = readCatalog();
  const { maxQueryLength, maxLimit, defaultLimit, pollAfterMs } = getSkillCenterConfig();
  const effective = catalog.skills.map(s => ({ id: s.canonicalSkillId, classification: classification(s.canonicalSkillId, catalog) }));
  return { taxonomy: catalog.taxonomy, counts: catalog.taxonomy.domains.map(d => ({ domainId: d.id, indexedUnique: effective.filter(s => s.classification.assignments.some(a => a.domainId === d.id)).length })), coverage: coverage(catalog, catalog.skills.length, 0), diagnostics, limits: { maxQueryLength, maxLimit, defaultLimit, pollAfterMs } };
}
