// 自主引擎运行态持久化（best-effort）—— 落盘 <agentDir>/pi-web-engine-runs.jsonl，
// 进程空闲超时 / 重启后磁盘仍保留，按需从磁盘 rehydrate，避免运行历史丢失。
// 纯 fs 实现（不依赖上游适配层），可在 node 单测中直接 import。
// 整体重写（原子 tmp+rename）：引擎运行数量有限，逐行 append 收益低且损坏面更大。

import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../config-file";
import type { RunState } from "./unified-engine-types";

const STORE_FILE = "pi-web-engine-runs.jsonl";
export const MAX_RECORDS = 100;

/** 内存索引缓存：runId → 在册记录 + 上一次落盘的归一化文本行。
 * 避免每次 upsert 都同步全量 read+JSON.parse（O(N)→O(1)）；
 * 仅当 cache 为 null（进程冷启动/重启）或显式 clearEngineRuns 时重建。 */
interface CacheEntry {
  updatedAt: number;
  line: string;
}
let cache: Map<string, CacheEntry> | null = null;
let cacheSize = 0;

function rebuildCache(): Map<string, CacheEntry> {
  const m = new Map<string, CacheEntry>();
  cacheSize = 0;
  for (const rec of loadAllEngineRuns()) {
    m.set(rec.id, { updatedAt: rec.updatedAt, line: JSON.stringify(rec) });
    cacheSize += 1;
  }
  cache = m;
  return m;
}

function recordToLine(rec: StoredEngineRun): string {
  return JSON.stringify(rec);
}

export interface StoredEngineRun {
  id: string;
  updatedAt: number;
  run: RunState;
}

function storeFilePath(): string {
  return join(getAgentDir(), STORE_FILE);
}

/** 读取全部已持久化运行（按 updatedAt 升序；best-effort，损坏/缺失返回空数组）。 */
export function loadAllEngineRuns(): StoredEngineRun[] {
  try {
    const file = storeFilePath();
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return [];
    const out: StoredEngineRun[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as StoredEngineRun;
        if (parsed && typeof parsed.id === "string" && parsed.run) out.push(parsed);
      } catch {
        // 跳过单行损坏。
      }
    }
    return out.sort((a, b) => a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}

/** upsert 一条运行态（按 runId；超出上限时丢弃最旧的记录）。
 *  内存索引缓存作为写入源真相，避免每次都同步全量 read+parse（O(N)→O(1)）；
 *  仅在显式 clearEngineRuns（如测试/清理）后失效重建。进程重启时 cache 为 null 亦重建。 */
export function saveEngineRun(run: RunState): void {
  try {
    if (!cache) cache = rebuildCache();
    const store = cache;

    const updatedAt = Date.parse(run.updatedAt) || Date.now();
    const record: StoredEngineRun = { id: run.runId, updatedAt, run };
    const line = recordToLine(record);

    const prev = store.get(run.runId);
    if (prev) {
      if (prev.line === line) return; // 内容无变化则跳过写盘
      store.set(run.runId, { updatedAt, line });
    } else {
      store.set(run.runId, { updatedAt, line });
      cacheSize += 1;
    }

    // 超出上限：丢弃最旧的记录（按 updatedAt 升序，与 loadAllEngineRuns 对齐）。
    if (cacheSize > MAX_RECORDS) {
      let oldestId: string | undefined;
      let oldestTs = Infinity;
      for (const [id, e] of store) {
        if (e.updatedAt < oldestTs) {
          oldestTs = e.updatedAt;
          oldestId = id;
        }
      }
      if (oldestId) {
        store.delete(oldestId);
        cacheSize -= 1;
      }
    }

    // 保持与原实现一致：按 updatedAt 升序落盘，超出上限即可读序稳定。
    const lines = [...store.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((e) => e.line)
      .join("\n");
    const file = storeFilePath();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, lines, "utf8");
    renameSync(tmp, file);
  } catch {
    // best-effort：持久化失败不阻断引擎。
  }
}

/** 仅用于测试 / 清理：清空持久化（best-effort）。 */
export function clearEngineRuns(): void {
  try {
    const file = storeFilePath();
    if (existsSync(file)) writeFileSync(file, "", "utf8");
    cache = new Map();
    cacheSize = 0;
  } catch {
    // ignore
  }
}
