import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, saveJson, stateDir } from "./journal";
import { CenterError, requireValue } from "./errors";
import type { Classification, Taxonomy } from "./types";

type Entry = { assignments: Classification["assignments"]; revision: string };
type Store = { version: 1; entries: Record<string, Entry> };
const path = () => join(stateDir(), "classifications.json");
function readStore(): Store {
  try {
    const value = readJson<Store>(path());
    if (!value) return { version: 1, entries: {} };
    requireValue(value.version === 1 && value.entries && typeof value.entries === "object" && !Array.isArray(value.entries), "INVALID_CLASSIFICATIONS", "个人分类文件格式无效。", 503);
    for (const entry of Object.values(value.entries)) requireValue(entry && typeof entry.revision === "string" && Array.isArray(entry.assignments) && entry.assignments.every(a => a && typeof a.domainId === "string" && (a.categoryId === null || typeof a.categoryId === "string")), "INVALID_CLASSIFICATIONS", "个人分类记录格式无效。", 503);
    return value;
  } catch { throw new CenterError(503, "INVALID_CLASSIFICATIONS", "无法读取个人分类，请检查技能中心 classifications.json 文件。"); }
}

export function personalClassification(identity: string, base: Classification): Classification {
  const entry = readStore().entries[identity];
  return entry ? { ...base, assignments: entry.assignments, state: entry.assignments.length ? "classified" : "unclassified", origin: "personal", personalRevision: entry.revision } : base;
}

export function validateAssignments(value: unknown, taxonomy: Taxonomy): Classification["assignments"] {
  requireValue(Array.isArray(value), "INVALID_CLASSIFICATION", "请选择领域与细分方向。");
  const result: Classification["assignments"] = [], seen = new Set<string>();
  for (const item of value) {
    requireValue(item && typeof item === "object", "INVALID_CLASSIFICATION", "分类格式无效。");
    const domain = taxonomy.domains.find(d => d.id === item.domainId);
    requireValue(domain && (item.categoryId === null || domain.categories.some(c => c.id === item.categoryId)), "INVALID_CLASSIFICATION", "领域或细分方向不存在，请刷新分类。");
    const key = `${domain.id}:${item.categoryId}`;
    requireValue(!seen.has(key), "INVALID_CLASSIFICATION", "不能重复选择同一分类。");
    seen.add(key); result.push({ domainId: domain.id, categoryId: item.categoryId });
  }
  // A domain-only assignment is redundant when more specific directions are selected.
  return result.filter(a => a.categoryId !== null || !result.some(b => b.domainId === a.domainId && b.categoryId !== null));
}

/** Caller holds the existing skill-center write lease for CAS + atomic persistence. */
export function savePersonalClassification(identity: string, assignments: Classification["assignments"], expected: unknown, reset = false) {
  const store = readStore();
  requireValue(expected === null || typeof expected === "string", "INVALID_INPUT", "请提供当前个人分类版本。");
  requireValue((store.entries[identity]?.revision ?? null) === expected, "CLASSIFICATION_CONFLICT", "分类已在其他页面修改，请刷新后重试。", 409);
  if (reset) delete store.entries[identity];
  else store.entries[identity] = { assignments, revision: randomUUID() };
  saveJson(path(), store);
}
