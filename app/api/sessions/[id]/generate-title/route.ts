import { NextResponse } from "next/server";
import { SessionManager, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";

const TITLE_PROMPT = `Summarize the following conversation in 3-8 words. Output ONLY the summary title, nothing else. No quotes, no punctuation at the end. Use the same language as the conversation.`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);

    // Don't regenerate if the session already has a custom name
    const existingName = sm.getSessionName();
    if (existingName) {
      return NextResponse.json({ title: existingName, skipped: true });
    }

    const entries = sm.getEntries() as never;
    const leafId = sm.getLeafId();
    const context = buildSessionContext(entries, leafId);

    // Need at least one user message and one assistant response
    if (!context.messages.some((m) => m.role === "user") || !context.messages.some((m) => m.role === "assistant")) {
      return NextResponse.json({ error: "Not enough messages to generate title" }, { status: 400 });
    }

    // Build a compact text summary of the conversation for the LLM
    const conversationText = context.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const content = m.content;
        if (typeof content === "string") {
          return `${m.role === "user" ? "User" : "Assistant"}: ${content}`;
        }
        if (Array.isArray(content)) {
          const textParts = content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          return `${m.role === "user" ? "User" : "Assistant"}: ${textParts}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    // Truncate to avoid using too many tokens
    const MAX_CHARS = 3000;
    const truncated = conversationText.length > MAX_CHARS
      ? conversationText.slice(0, MAX_CHARS) + "\n\n[... conversation truncated]"
      : conversationText;

    // Resolve the model to use — prefer the session's current model, fall back to default
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = registry.getAvailable();

    if (available.length === 0) {
      return NextResponse.json({ error: "No models available" }, { status: 400 });
    }

    // Try to use the session's current model
    let model = context.model
      ? registry.find(context.model.provider, context.model.modelId)
      : undefined;

    // Fall back to first available model
    if (!model) {
      model = available[0];
    }

    // Resolve API key through pi's ModelRegistry (handles AuthStorage, env vars, OAuth, etc.)
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 400 });
    }

    // Use completeSimple for a non-streaming call
    const result = await completeSimple(
      model as never,
      {
        systemPrompt: TITLE_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: truncated,
            timestamp: Date.now(),
          },
        ],
      },
      {
        maxTokens: 60,
        temperature: 0.3,
        apiKey: auth.apiKey,
        ...(auth.headers ? { headers: auth.headers } : {}),
      }
    );

    // Extract text from response
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      return NextResponse.json(
        { error: result.errorMessage ?? "LLM call failed" },
        { status: 500 }
      );
    }

    let title = "";
    if (result.content && Array.isArray(result.content)) {
      const textParts = result.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text);
      title = textParts.join("").trim();
    }

    if (!title) {
      return NextResponse.json({ error: "Failed to generate title" }, { status: 500 });
    }

    // Clean up the title — remove quotes, trailing punctuation
    title = title
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?。！？]+$/, "")
      .trim()
      .slice(0, 80); // Hard limit

    if (!title) {
      return NextResponse.json({ error: "Generated empty title" }, { status: 500 });
    }

    // Save the title via session manager
    sm.appendSessionInfo(title);

    return NextResponse.json({ title, skipped: false });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
