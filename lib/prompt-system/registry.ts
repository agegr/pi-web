// 模块注册表 —— 聚合来自各来源（app / agents-md / orchestrator / engine）的
// 提示词模块，挂在 globalThis 上跨 Next.js 热重载存活。
//
// 注意：本模块必须保持 @/-free（只相对导入 ./types），以便纯 node:test 单测
// 直接 import 具体 .ts 文件而无需 tsconfig 路径解析。

import type { PromptModule, PromptSource } from "./types";

declare global {
  // 注册表单例（跨热重载存活）。
  var __piPromptRegistry: PromptModule[] | undefined;
}

function all(): PromptModule[] {
  if (!globalThis.__piPromptRegistry) globalThis.__piPromptRegistry = [];
  return globalThis.__piPromptRegistry;
}

/** 注册/覆盖一组模块（同 id 后者覆盖前者）。通常在各来源模块文件加载时调用。 */
export function registerModules(modules: PromptModule[]): void {
  const map = new Map(all().map((m) => [m.id, m]));
  for (const m of modules) map.set(m.id, m);
  globalThis.__piPromptRegistry = [...map.values()];
}

/** 取全部模块，或按来源过滤。 */
export function getModules(source?: PromptSource): PromptModule[] {
  const ms = all();
  return source ? ms.filter((m) => m.source === source) : ms;
}

/** 按 id 取单个模块。 */
export function getModule(id: string): PromptModule | undefined {
  return all().find((m) => m.id === id);
}

/** 清空注册表（测试用）。 */
export function clearRegistry(): void {
  globalThis.__piPromptRegistry = [];
}
