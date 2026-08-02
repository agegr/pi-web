// 计划编排持久化（best-effort）—— 把编排器快照落盘到 <agentDir>/pi-web-orchestrations.jsonl，
// 进程重启/刷新后可 rehydrate，避免空闲超时或内存清除导致讨论数据丢失。
// 纯 fs 实现（不依赖 pi SDK），可在 node 单测中直接 import。
//
// 设计：编排数量有限，文件整体重写（原子 tmp+rename）而非逐行 append，降低复杂度与损坏面。
// 每次 status / round.end / plans 等关键事件由编排器调用 saveOrchestratorSnapshot 落盘。

import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../config-file";
import type { OrchestrationSnapshot } from "./orchestrator-types";

const STORE_FILE = "pi-web-orchestrations.jsonl";
const MAX_RECORDS = 50;

export interface StoredOrchestration {
  id: string;
  updatedAt: number;
  snapshot: unknown;
}

function storeFilePath(): string {
  return join(getAgentDir(), STORE_FILE);
}

/** 读取全部已持久化编排（按 updatedAt 升序；best-effort，损坏/缺失返回空数组）。 */
export function loadAllOrchestratorSnapshots(): StoredOrchestration[] {
  try {
    const file = storeFilePath();
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return [];
    const out: StoredOrchestration[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as StoredOrchestration;
        if (parsed && typeof parsed.id === "string" && parsed.snapshot) out.push(parsed);
      } catch {
        // 跳过单行损坏，不阻断整体加载。
      }
    }
    return out.sort((a, b) => a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}

/** upsert 一条编排快照（按 id；超出上限时丢弃最旧的记录）。 */
export function saveOrchestratorSnapshot(snapshot: OrchestrationSnapshot): void {
  try {
    const all = loadAllOrchestratorSnapshots();
    const record: StoredOrchestration = {
      id: snapshot.id,
      updatedAt: snapshot.updatedAt ?? Date.now(),
      snapshot,
    };
    const idx = all.findIndex((r) => r.id === snapshot.id);
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    all.sort((a, b) => a.updatedAt - b.updatedAt);
    const trimmed = all.slice(-MAX_RECORDS);
    const lines = trimmed.map((r) => JSON.stringify(r)).join("\n");
    const file = storeFilePath();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, lines, "utf8");
    renameSync(tmp, file);
  } catch {
    // best-effort：持久化失败不阻断讨论。
  }
}

/** 仅用于测试 / 清理：清空持久化（best-effort）。 */
export function clearOrchestratorSnapshots(): void {
  try {
    const file = storeFilePath();
    if (existsSync(file)) writeFileSync(file, "", "utf8");
  } catch {
    // ignore
  }
}

/**
 * 删除指定 id 的编排快照（幂等）。
 * 当前模型下 orchestrator 是平级、无父子结构——「child」概念由 SessionSidebar
 * 通过 pi session header 的 parentSession marker 表达，不在持久化文件中。
 * 本函数仅清理该 id 自身的记录；记录不存在时返回 removedCount=0 不抛错。
 * 返回 { removedCount, remaining } 便于上层 API 报告。
 */
export function removeOrchestratorSnapshot(id: string): {
  removedCount: number;
  remaining: number;
} {
  if (!id) return { removedCount: 0, remaining: 0 };
  try {
    const all = loadAllOrchestratorSnapshots();
    const filtered = all.filter((r) => r.id !== id);
    const removedCount = all.length - filtered.length;
    if (removedCount === 0) {
      return { removedCount: 0, remaining: all.length };
    }
    const lines = filtered.map((r) => JSON.stringify(r)).join("\n");
    const file = storeFilePath();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, lines, "utf8");
    renameSync(tmp, file);
    return { removedCount, remaining: filtered.length };
  } catch {
    // best-effort：失败按零进度返回，让上层决定是否重试
    return { removedCount: 0, remaining: 0 };
  }
}
