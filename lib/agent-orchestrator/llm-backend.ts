// 真实 LLM 后端 —— 把 completeSimple 适配为编排器所需的 LlmCompletion。
// 仅服务端（API 路由）使用；直接引用 pi SDK，满足 anti-corruption 约束。
// 支持按角色指定底层模型（provider/model），并按 modelId 缓存补全闭包，减少重复解析。

import {
  ModelRegistry,
  ModelRuntime,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { LlmCompletion } from "./runner";
import { resolveRoleModelId, type RoleModelMap } from "@/lib/plan-mode-config";

// 跨 HMR 存活的补全闭包缓存（key = cwd::modelId）。
declare global {
  var __piLlmCompletionCache: Map<string, LlmCompletion> | undefined;
}

function completionCache(): Map<string, LlmCompletion> {
  if (!globalThis.__piLlmCompletionCache) globalThis.__piLlmCompletionCache = new Map();
  return globalThis.__piLlmCompletionCache;
}

// 从模型消息体中提取 assistant 文本（兼容 text 块或纯字符串）。
function getAssistantText(message: unknown): string {
  if (!message) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
      .map((b) => (b as { text?: string }).text ?? "");
    return texts.join("").trim();
  }
  return "";
}

// 解析默认模型与鉴权，可选指定 modelId。
async function resolveModelAndAuth(cwd?: string, modelId?: string) {
  const agentDir = getAgentDir();
  const modelRuntime = await ModelRuntime.create();
  const registry = new ModelRegistry(modelRuntime);

  let model: ReturnType<typeof registry.find> | undefined;

  // 指定了具体模型（provider/model 或仅 model）。
  if (modelId) {
    if (modelId.includes("/")) {
      const [provider, ...rest] = modelId.split("/");
      model = registry.find(provider, rest.join("/"));
    } else {
      const mgr = SettingsManager.create(cwd ?? process.cwd(), agentDir);
      await mgr.reload();
      const dp = mgr.getDefaultProvider();
      if (dp) model = registry.find(dp, modelId);
    }
  }

  // 未指定或指定失败 → 回退全局默认模型。
  if (!model) {
    const mgr = SettingsManager.create(cwd ?? process.cwd(), agentDir);
    await mgr.reload();
    const dp = mgr.getDefaultProvider();
    const dm = mgr.getDefaultModel();
    if (dp && dm) model = registry.find(dp, dm);
  }
  if (!model) return undefined;

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return undefined;
  return { model, apiKey: auth.apiKey, headers: auth.headers, completeSimple };
}

/** 构造一个绑定到指定 cwd（与可选 modelId）的 LlmCompletion（每次调用解析模型与鉴权）。 */
export function createPiLlmCompletion(cwd?: string, modelId?: string): LlmCompletion {
  const cacheKey = `${cwd ?? ""}::${modelId ?? "default"}`;
  const cached = completionCache().get(cacheKey);
  if (cached) return cached;

  const fn: LlmCompletion = async (systemPrompt: string, userMessage: string): Promise<string> => {
    const resolved = await resolveModelAndAuth(cwd, modelId);
    if (!resolved) throw new Error("无可用的默认模型或未配置 API Key");
    const { model, apiKey, headers, completeSimple } = resolved;
    const message = await completeSimple(
      model,
      {
        systemPrompt,
        messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
      },
      {
        apiKey,
        headers,
        maxTokens: 4096,
        timeoutMs: 90_000,
        maxRetries: 0,
        cacheRetention: "none",
      } as never,
    );
    return getAssistantText(message);
  };

  completionCache().set(cacheKey, fn);
  return fn;
}

/**
 * 解析某角色应使用的底层模型补全（按角色默认 > 用户配置映射 > 全局默认）。
 * 用于在编排器中为每个专业领域 Agent 路由不同底层模型。
 */
export function resolveLlmForRole(
  cwd: string | undefined,
  role: { id: string; modelId?: string },
  map: RoleModelMap,
): LlmCompletion {
  const modelId = resolveRoleModelId(role.id, role.modelId, map);
  return createPiLlmCompletion(cwd, modelId);
}
