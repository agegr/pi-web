// storage.ts —— 自主引擎结构化持久化（M2 / 等价迁移 autoplan repository/sqlite 的 requirement/plan/task/feedback + outbox）
//
// 纯 fs jsonl 实现（不引入 better-sqlite3 原生依赖，规避构建/CI 风险；等价迁移目标中的
// 「better-sqlite3 / jsonl 双写」二选一，此处取 jsonl 方案，原子 tmp+rename 落盘）。
// 落盘为事件/实体的权威源，支撑进程空闲超时/重启后无损恢复（对应 §8 持久化验收）。
//
// 比 persistence.ts（仅 RunState）更细：向下游编排与前端提供 requirement/plan/task/feedback/outbox 全量读写。
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config-file";
import type { Requirement, Plan, Task } from "./unified-engine-types";
import type { Feedback } from "./autoplan-domain";
import type { BusEvent } from "./runtime/event-bus";

const STORE_DIR = "unified-engine";
const MAX_RECORDS_PER_ENTITY = 500;
const MAX_OUTBOX = 2000;

interface EntityCache<T> {
  byId: Map<string, T>;
  /** 行序列化缓存（避免每次写盘重新 JSON.stringify 全量）。 */
  lineOf: Map<string, string>;
}

function entityCache<T extends { id: string }>(): EntityCache<T> {
  return { byId: new Map(), lineOf: new Map() };
}

function dirPath(): string {
  const d = join(getAgentDir(), STORE_DIR);
  try {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  } catch {
    /* ignore */
  }
  return d;
}

function filePath(name: string): string {
  return join(dirPath(), `${name}.jsonl`);
}

function readAll<T>(name: string): T[] {
  try {
    const f = filePath(name);
    if (!existsSync(f)) return [];
    const raw = readFileSync(f, "utf8").trim();
    if (!raw) return [];
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as T;
        if (parsed && typeof (parsed as { id?: unknown }).id === "string") out.push(parsed);
      } catch {
        /* 跳过损坏行 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeAll<T>(name: string, cache: EntityCache<T>): void {
  try {
    const lines = [...cache.lineOf.values()];
    const f = filePath(name);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
    renameSync(tmp, f);
  } catch {
    /* best-effort */
  }
}

/** 通用 upsert：写入单条实体并原子落盘（O(1) 索引 + 超量裁剪最旧）。 */
function upsert<T extends { id: string }>(
  name: string,
  cache: EntityCache<T>,
  record: T,
  maxRecords = MAX_RECORDS_PER_ENTITY,
): void {
  const line = JSON.stringify(record);
  const existed = cache.lineOf.has(record.id);
  cache.byId.set(record.id, record);
  cache.lineOf.set(record.id, line);
  // 超量裁剪最旧（按插入顺序：Map 保留插入序，删除首个即最旧）。
  if (!existed && cache.byId.size > maxRecords) {
    const oldestId = cache.byId.keys().next().value as string | undefined;
    if (oldestId) {
      cache.byId.delete(oldestId);
      cache.lineOf.delete(oldestId);
    }
  }
  writeAll(name, cache);
}

// ── 各实体缓存（globalThis 跨 HMR 存活） ──
const g = globalThis as unknown as {
  __ueReqCache?: EntityCache<Requirement>;
  __uePlanCache?: EntityCache<Plan>;
  __ueTaskCache?: EntityCache<Task>;
  __ueFbCache?: EntityCache<Feedback>;
  __ueOutboxCache?: EntityCache<BusEvent & { id: string }>;
};

function reqCache() {
  if (!g.__ueReqCache) g.__ueReqCache = entityCache<Requirement>();
  return g.__ueReqCache;
}
function planCache() {
  if (!g.__uePlanCache) g.__uePlanCache = entityCache<Plan>();
  return g.__uePlanCache;
}
function taskCache() {
  if (!g.__ueTaskCache) g.__ueTaskCache = entityCache<Task>();
  return g.__ueTaskCache;
}
function fbCache() {
  if (!g.__ueFbCache) g.__ueFbCache = entityCache<Feedback>();
  return g.__ueFbCache;
}
function outboxCache() {
  if (!g.__ueOutboxCache) g.__ueOutboxCache = entityCache<BusEvent & { id: string }>();
  return g.__ueOutboxCache;
}

// 首次访问时从磁盘重建索引（best-effort）。
let rebuilt = false;
function ensureRebuilt(): void {
  if (rebuilt) return;
  rebuilt = true;
  for (const r of readAll<Requirement>("requirements")) upsert("requirements", reqCache(), r);
  for (const p of readAll<Plan>("plans")) upsert("plans", planCache(), p);
  for (const t of readAll<Task>("tasks")) upsert("tasks", taskCache(), t);
  for (const f of readAll<Feedback>("feedback")) upsert("feedback", fbCache(), f);
}

// ── 公开 API ──
export function saveRequirement(req: Requirement): void {
  ensureRebuilt();
  upsert("requirements", reqCache(), req);
}
export function loadRequirements(): Requirement[] {
  ensureRebuilt();
  return [...reqCache().byId.values()];
}
export function getRequirement(id: string): Requirement | undefined {
  ensureRebuilt();
  return reqCache().byId.get(id);
}

export function savePlan(plan: Plan): void {
  ensureRebuilt();
  upsert("plans", planCache(), plan);
}
export function loadPlans(): Plan[] {
  ensureRebuilt();
  return [...planCache().byId.values()];
}
export function getPlan(id: string): Plan | undefined {
  ensureRebuilt();
  return planCache().byId.get(id);
}

export function saveTask(task: Task): void {
  ensureRebuilt();
  upsert("tasks", taskCache(), task);
}
export function loadTasks(): Task[] {
  ensureRebuilt();
  return [...taskCache().byId.values()];
}
export function getTask(id: string): Task | undefined {
  ensureRebuilt();
  return taskCache().byId.get(id);
}

export function saveFeedback(fb: Feedback): void {
  ensureRebuilt();
  upsert("feedback", fbCache(), fb);
}
export function loadFeedback(): Feedback[] {
  ensureRebuilt();
  return [...fbCache().byId.values()];
}

/** outbox：事件权威源。id 含单调递增序号，避免同毫秒同类型事件碰撞被覆盖。 */
let outboxSeq = 0;
export function appendOutbox(event: BusEvent): void {
  ensureRebuilt();
  const id = `${event.at}::${event.kind}::${event.runId ?? ""}::${outboxSeq++}`;
  upsert("outbox", outboxCache(), { ...event, id }, MAX_OUTBOX);
}
export function loadOutbox(limit = 200): BusEvent[] {
  ensureRebuilt();
  const all = [...outboxCache().byId.values()];
  return (all as unknown as BusEvent[]).slice(Math.max(0, all.length - limit));
}

/** 清空全部实体（测试/重置用，best-effort）。 */
export function clearAllStorage(): void {
  for (const name of ["requirements", "plans", "tasks", "feedback", "outbox"]) {
    try {
      const f = filePath(name);
      if (existsSync(f)) writeFileSync(f, "", "utf8");
    } catch {
      /* ignore */
    }
  }
  g.__ueReqCache = entityCache<Requirement>();
  g.__uePlanCache = entityCache<Plan>();
  g.__ueTaskCache = entityCache<Task>();
  g.__ueFbCache = entityCache<Feedback>();
  g.__ueOutboxCache = entityCache<BusEvent & { id: string }>();
  rebuilt = true; // 清空即视为已重建（空）
}
