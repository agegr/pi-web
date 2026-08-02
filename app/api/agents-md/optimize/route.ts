// POST /api/agents-md/optimize
// body: { content: string, file?: "agents"|"system"|"append", cwd?: string, instruction?: string }
// → { optimized: string }
//
// 用默认模型的 LLM 对 AGENTS.md / SYSTEM.md / APPEND_SYSTEM.md 做提示词优化。
//
// 跟随上游重写（2026-08-02）：原依赖 AuthStorage / ModelRegistry.create(AuthStorage.create(), …)
// 及 pi-ai/compat 的 completeSimple 旧式取模型/key 流程，SDK 0.83.0 已重构。改为复用
// lib/pi-model-creds 的 resolveDefaultModelCredentials（与压缩通道同范式）解析
// 默认 provider/model + apiKey/headers，completeSimple 仍取自 pi-ai/compat（HEAD 已用）。
// 该路由不校验 CSRF：前端 AgentsConfig 对 /api/agents-md 命名空间统一使用裸 fetch，
// 且现有 app/api/agents-md/route.ts 亦未校验，保持外部行为一致以免优化按钮再次 403。

import { type NextRequest, NextResponse } from "next/server";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { resolveDefaultModelCredentials, ModelCredentialsError } from "@/lib/pi-model-creds";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;

// 从 assistant 消息中提取纯文本（替代已删的 @/lib/api-shared.getAssistantText）。
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      content?: string;
      file?: string;
      cwd?: string;
      instruction?: string;
    };
    const content = body.content ?? "";
    const fileType = body.file ?? "agents";
    if (!content.trim()) {
      return NextResponse.json(
        { error: "Content is empty — nothing to optimize." },
        { status: 400 },
      );
    }

    // 解析默认 provider/model + apiKey/headers（SDK 0.83.0 范式）。
    let creds;
    try {
      creds = await resolveDefaultModelCredentials(body.cwd);
    } catch (err) {
      if (err instanceof ModelCredentialsError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const customInstruction = body.instruction?.trim();
    const promptContext =
      fileType === "system"
        ? "This is a SYSTEM.md file that COMPLETELY REPLACES the agent's default system prompt. It should define the agent's core identity, available tools, and operating guidelines."
        : fileType === "append"
          ? "This is an APPEND_SYSTEM.md file that is APPENDED to the system prompt. It should contain supplementary instructions without repeating the base prompt."
          : "This is an AGENTS.md file that provides project-specific instructions and guidelines injected as project context.";
    const systemPrompt = [
      `You are an expert at writing prompt instruction files for AI coding agents. ${promptContext}`,
      "Optimize the following content for clarity, completeness, and structure.",
      "Keep it concise and actionable.",
      "Preserve all important technical details, conventions, and warnings.",
      customInstruction ? `Additional instruction: ${customInstruction}` : "",
      "Respond with ONLY the optimized markdown. No explanation, no code fences around the whole thing.",
    ]
      .filter(Boolean)
      .join("\n");

    const message = await completeSimple(
      creds.model as never,
      {
        messages: [{ role: "user", content, timestamp: Date.now() }],
      } as never,
      {
        apiKey: creds.apiKey,
        headers: creds.headers,
        maxTokens: 8192,
        timeoutMs: TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        // Inject system prompt via the model's system message capability
        systemPrompt,
      } as never,
    );

    const optimized = getAssistantText(message as never).trim();
    if (!optimized) {
      return NextResponse.json({ error: "AI returned empty content." }, { status: 500 });
    }

    return NextResponse.json({ optimized });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
