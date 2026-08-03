// lib/prompt-loader-options.ts —— 把 prompt-modules-state 的开关态转成
// SDK ResourceLoader 的 agentsFilesOverride（见 docs/PROMPTS-PANEL-PLAN.md 三、源头注入）。
//
// 总闸（getAgentsMdModular）关 → 返回 {}（行为同现状，零风险）；
// 开 → 返回 { agentsFilesOverride }：把 AGENTS.md 的 content 用 composeAgentsMd
//      按模块开关裁剪后塞回。完全在上游 buildSystemPrompt 的「输入」侧操作，
//      不 parse 输出字符串，上游友好（见 PLAN-ENGINE-INTEGRATION.md 三、Prompt 接通）。

import { composeAgentsMd } from "./prompt-system/agents-md-modules";
import { getAgentsMdModular } from "./prompt-modules-state";

interface AgentsFilesOverrideBase {
  agentsFiles: Array<{ path: string; content: string }>;
}

/**
 * 返回 CreateAgentSessionServicesOptions.resourceLoaderOptions 的内容。
 * 结构子类型兼容 SDK DefaultResourceLoaderOptions（rpc-manager 传入时类型对齐）。
 */
export function getPromptModuleLoaderOptions(): {
  agentsFilesOverride?: (base: AgentsFilesOverrideBase) => AgentsFilesOverrideBase;
} {
  if (!getAgentsMdModular()) return {};
  return {
    agentsFilesOverride: (base: AgentsFilesOverrideBase): AgentsFilesOverrideBase => ({
      agentsFiles: base.agentsFiles.map((f) =>
        /agents\.md$/i.test(f.path) ? { ...f, content: composeAgentsMd(f.content, {}) } : f,
      ),
    }),
  };
}
