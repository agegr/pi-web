// LLM 语义压缩通道 —— 复用默认模型/Key（与 app/api/agents-md/optimize 同范式）。
//
// 服务侧使用（依赖 SDK）。纯逻辑压缩在 compress.ts，本文件仅负责
// 「可选 LLM 精炼」并在失败时兜底回退离线，绝不阻断主流程。
// 跟随上游重写（2026-08-02）：原 @/lib/pi / @/lib/api-shared 已被上游删除，
// 改为直接消费 SDK 的 completeSimple（pi-ai/compat）并内联 getAssistantText。

import { completeSimple } from "@earendil-works/pi-ai/compat";
import { resolveDefaultModelCredentials, type ModelCredentials } from "../pi-model-creds";
import { compressOffline } from "./compress";
import type { CompressResult } from "./types";

const TIMEOUT_MS = 60_000;

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

/** 用 LLM 对一段提示词做语义保持压缩。 */
export async function compressWithLlm(
  text: string,
  creds: ModelCredentials,
): Promise<CompressResult> {
  const systemPrompt = [
    "You are a prompt compression engine.",
    "Rewrite the following system-prompt excerpt to be as concise as possible while preserving EVERY hard constraint, rule, and prohibited/required behavior verbatim in meaning.",
    "Remove filler, redundancy, and verbose framing, but do NOT drop or weaken any instruction, constraint, or safety rule.",
    "Respond with ONLY the compressed text. No explanation, no code fences around the whole thing.",
  ].join("\n");

  const message = await completeSimple(
    creds.model as never,
    {
      messages: [{ role: "user", content: text, timestamp: Date.now() }],
    } as never,
    {
      apiKey: creds.apiKey,
      headers: creds.headers,
      maxTokens: 8192,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      systemPrompt,
    } as never,
  );

  const compressed = getAssistantText(message as never).trim();
  const before = text.length;
  const after = compressed.length;
  return {
    text: compressed,
    charsBefore: before,
    charsAfter: after,
    ratio: before > 0 ? (before - after) / before : 0,
    usedLlm: true,
  };
}

/**
 * 压缩单个模块文本：默认离线（零成本），useLlm 时走 LLM 语义压缩。
 * 任何 LLM 失败（无默认模型/无 Key/超时/空响应）一律兜底回退离线压缩。
 */
export async function compressModule(
  text: string,
  opts: { useLlm?: boolean; creds?: ModelCredentials; cwd?: string } = {},
): Promise<CompressResult> {
  if (!opts.useLlm) return compressOffline(text);
  try {
    const creds = opts.creds ?? (await resolveDefaultModelCredentials(opts.cwd));
    const result = await compressWithLlm(text, creds);
    if (!result.text) return compressOffline(text);
    return result;
  } catch {
    return compressOffline(text);
  }
}
