// 动态提交策略 —— 可选 LLM 精排（服务侧，依赖 SDK）。
//
// 启发式选择（select.ts）做默认筛选与兜底；本文件提供一次轻量 LLM 分类，
// 返回更相关模块 id 集合。任何失败一律返回 null，由调用方回退启发式。
// 跟随上游重写（2026-08-02）：原 @/lib/pi / @/lib/api-shared 已被上游删除，
// 改为直接消费 SDK 的 completeSimple（pi-ai/compat）并内联 getAssistantText。

import { completeSimple } from "@earendil-works/pi-ai/compat";
import { resolveDefaultModelCredentials, type ModelCredentials } from "../pi-model-creds";
import type { PromptModule } from "./types";

const TIMEOUT_MS = 30_000;

/** 从 assistant 消息中提取纯文本（替代已删的 @/lib/api-shared.getAssistantText）。 */
function getAssistantText(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } => {
        try {
          return (
            typeof block === "object" &&
            block !== null &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string"
          );
        } catch {
          return false;
        }
      })
      .map((block) => block.text)
      .join("");
  }
  return "";
}

/** 用 LLM 对候选模块按任务相关性分类，返回选中的模块 id 集合；失败返回 null。 */
export async function classifyModules(
  candidates: PromptModule[],
  userInput: string,
  creds: ModelCredentials,
): Promise<Set<string> | null> {
  const list = candidates
    .map((m) => `- ${m.id} [${m.category}] ${m.text.slice(0, 140).replace(/\s+/g, " ")}`)
    .join("\n");
  const systemPrompt = [
    "You are a prompt-module router.",
    "Given a user task and a list of system-prompt modules, select ONLY the module ids relevant to performing the task well.",
    "Always keep modules whose category is 'safety', 'constraints', or 'identity' unless clearly irrelevant.",
    'Respond with a JSON array of selected module ids, e.g. ["a.b","c.d"]. No other text.',
  ].join("\n");

  const message = await completeSimple(
    creds.model as never,
    {
      messages: [
        {
          role: "user",
          content: `TASK:\n${userInput}\n\nMODULES:\n${list}`,
          timestamp: Date.now(),
        },
      ],
    } as never,
    {
      apiKey: creds.apiKey,
      headers: creds.headers,
      maxTokens: 1024,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      systemPrompt,
    } as never,
  );

  const text = getAssistantText(message as never).trim();
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === "string"));
  } catch {
    /* 非法 JSON → 回退 */
  }
  return null;
}

/**
 * 自适应选择：启发式默认 + 可选 LLM 精排。
 * useLlmSelect 且凭证可解析时调用 classifyModules；成功则用其集合（alwaysOn 必含），
 * 失败或关闭时回退启发式。绝不因 LLM 错误而阻断，返回 SelectionResult。
 */
export async function selectModulesAdaptive(
  candidates: PromptModule[],
  opts: {
    userInput?: string;
    context?: string;
    tags?: string[];
    useLlmSelect?: boolean;
    cwd?: string;
  } = {},
): Promise<{ selected: PromptModule[]; skipped: PromptModule[]; usedLlm: boolean }> {
  // 复用启发式
  const { selectModules } = await import("./select");
  const heuristic = selectModules(candidates, {
    userInput: opts.userInput,
    context: opts.context,
    tags: opts.tags,
  });

  if (!opts.useLlmSelect) {
    return { selected: heuristic.selected, skipped: heuristic.skipped, usedLlm: false };
  }

  try {
    const creds = await resolveDefaultModelCredentials(opts.cwd);
    const ids = await classifyModules(candidates, opts.userInput || opts.context || "", creds);
    if (ids && ids.size) {
      const picked = candidates.filter((m) => m.alwaysOn || ids.has(m.id));
      // 若 LLM 结果过激（几乎全跳过），回退启发式以保安全
      if (picked.length >= Math.max(1, Math.ceil(candidates.length * 0.2))) {
        const selSet = new Set(picked.map((m) => m.id));
        return {
          selected: picked,
          skipped: candidates.filter((m) => !selSet.has(m.id)),
          usedLlm: true,
        };
      }
    }
  } catch {
    /* 回退启发式 */
  }
  return { selected: heuristic.selected, skipped: heuristic.skipped, usedLlm: false };
}
