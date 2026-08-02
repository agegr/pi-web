// 模块清单聚合 —— 把各来源（app 注册模块 + agents-md 解析模块）合并为可管理列表。
//
// 本模块刻意 @/-free（仅相对导入 ./registry、./agents-md-modules），服务侧 API
// 路由与 node 单测均可直接 import。

import type { PromptModule } from "./types";
import { getModules } from "./registry";
import { parseAgentsMd, readAgentsMdContent } from "./agents-md-modules";

/** 聚合当前所有可管理的提示词模块（app 来源来自注册表，agents-md 来自文件解析）。 */
export function gatherManagedModules(): PromptModule[] {
  const appMods = getModules();
  let agentsMods: PromptModule[] = [];
  try {
    const content = readAgentsMdContent();
    if (content) agentsMods = parseAgentsMd(content);
  } catch {
    // 无 AGENTS.md 或读取失败 → 仅返回 app 模块
  }
  return [...appMods, ...agentsMods];
}

/** 按 id 从聚合清单取模块（app 注册表优先，其次 agents-md 解析结果）。 */
export function findManagedModule(id: string): PromptModule | undefined {
  const all = gatherManagedModules();
  return all.find((m) => m.id === id);
}
