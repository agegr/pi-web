// 计划模式角色→模型映射配置（持久化）
// 维护「角色 id → 底层模型（provider/model）」映射，落盘于 <agentDir>/pi-web-plan-config.json，
// 供 PlanPanel 下拉实时配置并持久化；运行时由 llm-backend.resolveLlmForRole 按角色解析。
// 纯 fs 实现，不依赖 pi SDK，可在 node 单测中直接 import。

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./config-file";

const CONFIG_FILE = "pi-web-plan-config.json";

/** 角色 id → 模型标识（provider/model）。 */
export type RoleModelMap = Record<string, string>;

function configFilePath(agentDir?: string): string {
  return join(agentDir || getAgentDir(), CONFIG_FILE);
}

/** 读取角色→模型映射（best-effort，损坏/缺失返回空对象）。 */
export function loadPlanModelConfig(agentDir?: string): RoleModelMap {
  try {
    const file = configFilePath(agentDir);
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: RoleModelMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.trim().length > 0) {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 原子写（tmp+rename）角色→模型映射。 */
export function savePlanModelConfig(map: RoleModelMap, agentDir?: string): void {
  try {
    const file = configFilePath(agentDir);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
    renameSync(tmp, file);
  } catch {
    // best-effort：持久化失败不阻断讨论。
  }
}

/**
 * 解析某角色应使用的底层模型：
 * 角色内置默认（role.modelId） > 用户配置映射（map[roleId]） > 未指定（返回 undefined 表示回退全局默认模型）。
 */
export function resolveRoleModelId(
  roleId: string,
  roleModelId: string | undefined,
  map: RoleModelMap,
): string | undefined {
  return roleModelId || map[roleId];
}
