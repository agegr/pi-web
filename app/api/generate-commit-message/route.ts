import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function POST(req: NextRequest) {
  try {
    const { cwd } = await req.json();
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

    // Get diff of all changed files (unstaged + staged)
    let diff: string;
    try {
      diff = execSync("git -c core.quotePath=false diff HEAD", { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 });
    } catch {
      return NextResponse.json({ error: "No changes found" }, { status: 400 });
    }

    if (!diff.trim()) {
      return NextResponse.json({ error: "No changes to describe" }, { status: 400 });
    }

    // Truncate diff if too long (keep first ~30K chars)
    const maxLen = 30000;
    const truncated = diff.length > maxLen ? diff.slice(0, maxLen) + "\n... (truncated)" : diff;

    // Read models config
    const modelsPath = join(homedir(), ".pi", "agent", "models.json");
    let modelsConfig: any;
    try {
      modelsConfig = JSON.parse(readFileSync(modelsPath, "utf8"));
    } catch {
      return NextResponse.json({ error: "Cannot read models config" }, { status: 500 });
    }

    // Find first available provider with API key
    let baseUrl = "";
    let apiKey = "";
    let modelId = "";

    for (const [name, provider] of Object.entries(modelsConfig.providers || {}) as [string, any][]) {
      if (provider.baseUrl && provider.apiKey) {
        baseUrl = provider.baseUrl;
        apiKey = provider.apiKey;
        // Prefer a fast/cheap model for commit messages
        const models = provider.models || [];
        const fast = models.find((m: any) => m.id.includes("flash")) || models[0];
        modelId = fast?.id || "";
        break;
      }
    }

    if (!baseUrl || !apiKey || !modelId) {
      return NextResponse.json({ error: "No valid provider found" }, { status: 500 });
    }

    // Call LLM
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are a git commit message generator. Given a git diff, produce a concise commit message in the Conventional Commits format. Rules:
- First line: type(scope): description (max 72 chars, in Chinese)
- Types: feat, fix, refactor, style, docs, chore, perf, test
- Use Chinese for the description
- No trailing period on first line
- If needed, add a blank line then bullet points (in Chinese) explaining key changes
- Keep it under 5 lines total
- Output ONLY the commit message, nothing else`,
          },
          {
            role: "user",
            content: `Generate a commit message for this diff:\n\n${truncated}`,
          },
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `LLM call failed: ${res.status}`, details: errText }, { status: 500 });
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message?.content?.trim() || "";
    const finishReason = choice?.finish_reason;

    if (!message) {
      return NextResponse.json({ error: "LLM returned empty response" }, { status: 500 });
    }
    if (finishReason === "length") {
      // Response was truncated — still return it but flag it
      return NextResponse.json({ message, truncated: true });
    }

    return NextResponse.json({ message });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
