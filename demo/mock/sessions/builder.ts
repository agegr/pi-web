/**
 * Expands a SessionScript into the entries pi writes to a session .jsonl file,
 * with realistic ids, timestamps, token usage and cost.
 */
import type { AgentUsage, SessionEntry, SessionMessage } from "@/lib/types";
import { pick, type DemoLocale } from "../locale";
import { originalText, readProjectText } from "../files";
import { editToolDetails } from "../diff";
import { PROJECT_FILE_EDITS, PROJECT_FILE_OVERRIDES } from "../data/project-files";
import { MODEL_API, MODEL_PRICING } from "../data/models";
import type { Round, SessionScript, Text, ToolUse } from "./types";

export interface BuiltSession {
  entries: SessionEntry[];
  leafId: string | null;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.6));
}

export function usageFor(provider: string, modelId: string, input: number, output: number, cacheRead: number): AgentUsage & { totalTokens: number } {
  const price = MODEL_PRICING[`${provider}/${modelId}`] ?? { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 };
  const cost = {
    input: (input * price.input) / 1e6,
    output: (output * price.output) / 1e6,
    cacheRead: (cacheRead * price.cacheRead) / 1e6,
    cacheWrite: 0,
    total: 0,
  };
  cost.total = cost.input + cost.output + cost.cacheRead;
  return { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost };
}

export function readToolOutput(content: string, offset?: number, limit?: number): string {
  const lines = content.split("\n");
  const start = offset ? Math.max(0, offset - 1) : 0;
  if (limit === undefined) return lines.slice(start).join("\n");
  const end = Math.min(start + limit, lines.length);
  const selected = lines.slice(start, end).join("\n");
  const remaining = lines.length - end;
  return remaining > 0 ? `${selected}\n\n[${remaining} more lines in file. Use offset=${end + 1} to continue.]` : selected;
}

function hashPrefix(id: string): string {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 4);
}

export async function buildSession(
  script: SessionScript,
  locale: DemoLocale,
  now: number,
  projectRootFor: (cwd: string) => string,
): Promise<BuiltSession> {
  const t = (text: Text) => pick(text, locale);
  const prefix = hashPrefix(script.id);
  let counter = 0;
  const nextId = () => `${prefix}${(++counter).toString(16).padStart(4, "0")}`;

  const entries: SessionEntry[] = [];
  const marks = new Map<string, string>();
  let parentId: string | null = null;
  let clock = now - script.startedMinutesAgo * 60_000;
  let provider = "openai-codex";
  let modelId = "gpt-5.5";
  let contextTokens = 9_400; // system prompt + tool schemas
  let toolCallCounter = 0;

  const push = (entry: Omit<SessionEntry, "id" | "parentId" | "timestamp">, at = clock): string => {
    const id = nextId();
    entries.push({ ...entry, id, parentId, timestamp: new Date(at).toISOString() } as SessionEntry);
    parentId = id;
    return id;
  };
  const message = (msg: SessionMessage) => push({ type: "message", message: msg } as never);

  const resolveTool = async (tool: ToolUse): Promise<{ args: Record<string, unknown>; text: string; details?: unknown; isError?: boolean }> => {
    const root = projectRootFor(script.cwd);
    const result = tool.result;
    if (typeof result === "object" && "readFile" in result) {
      // Scripted reads happen before the scripted edits, so show the original text.
      const content = root.endsWith("/pi-web")
        ? ((await originalText(result.readFile).catch(() => null)) ?? await readProjectText(`${root}/${result.readFile}`).catch(() => null))
        : await readProjectText(`${root}/${result.readFile}`).catch(() => null);
      if (content === null) return { args: tool.args, text: `ENOENT: no such file or directory, open '${root}/${result.readFile}'`, isError: true };
      let offset = result.offset;
      if (result.anchor) {
        const index = content.split("\n").findIndex((line) => line.includes(result.anchor!));
        if (index >= 0) offset = Math.max(1, index + 1 - (result.anchorLinesBefore ?? 0));
      }
      const args = { ...tool.args, ...(offset !== undefined ? { offset } : {}), ...(result.limit !== undefined ? { limit: result.limit } : {}) };
      return { args, text: readToolOutput(content, offset, result.limit) };
    }
    if (typeof result === "object" && "editKey" in result) {
      const edit = PROJECT_FILE_EDITS.find((candidate) => candidate.key === result.editKey)!;
      const args = { path: edit.path, edits: edit.edits };
      // The overlay already contains the edit; diff against the snapshot text.
      const before = await originalText(edit.path).catch(() => null);
      if (before === null) return { args, text: `Could not edit file: ${edit.path}.`, isError: true };
      let after = before;
      for (const change of edit.edits) after = after.replace(change.oldText, change.newText);
      if (after === before) return { args, text: `Successfully replaced ${edit.edits.length} block(s) in ${edit.path}.` };
      return { args, text: `Successfully replaced ${edit.edits.length} block(s) in ${edit.path}.`, details: editToolDetails(edit.path, before, after) };
    }
    if (typeof result === "object" && "writePath" in result) {
      return { args: { path: result.writePath, content: PROJECT_FILE_OVERRIDES[result.writePath] ?? "" }, text: `Successfully wrote to ${result.writePath}` };
    }
    return { args: tool.args, text: t(result as Text) };
  };

  const assistantRound = async (round: Round) => {
    const blocks: Record<string, unknown>[] = [];
    if (round.thinking) blocks.push({ type: "thinking", thinking: t(round.thinking) });
    if (round.text) blocks.push({ type: "text", text: t(round.text) });
    const calls: { tool: ToolUse; id: string; resolved: Awaited<ReturnType<typeof resolveTool>> }[] = [];
    for (const tool of round.tools ?? []) {
      calls.push({ tool, id: `call_${prefix}${(++toolCallCounter).toString().padStart(3, "0")}`, resolved: await resolveTool(tool) });
    }
    for (const { tool, id, resolved } of calls) {
      blocks.push({ type: "toolCall", id, name: tool.name, arguments: resolved.args });
    }
    const generated = blocks.map((block) => JSON.stringify(block)).join("");
    const output = round.outputTokens ?? estimateTokens(generated);
    clock += (round.seconds ?? Math.min(40, 3 + output / 45)) * 1000;
    const cacheRead = Math.round(contextTokens * 0.86);
    const usage = usageFor(provider, modelId, contextTokens - cacheRead, output, cacheRead);
    contextTokens += output;
    message({
      role: "assistant",
      content: blocks,
      api: MODEL_API[provider] ?? "openai-completions",
      provider,
      model: modelId,
      usage,
      stopReason: calls.length > 0 ? "toolUse" : "stop",
      timestamp: clock,
    } as never);
    for (const { tool, id, resolved } of calls) {
      const text = resolved.text;
      clock += (tool.seconds ?? 1) * 1000;
      contextTokens += estimateTokens(text);
      message({
        role: "toolResult",
        toolCallId: id,
        toolName: tool.name,
        content: [{ type: "text", text }],
        ...((tool.details ?? resolved.details) !== undefined ? { details: tool.details ?? resolved.details } : {}),
        isError: tool.isError ?? resolved.isError ?? false,
        timestamp: clock,
      } as never);
    }
  };

  for (const step of script.steps) {
    switch (step.kind) {
      case "model":
        provider = step.provider;
        modelId = step.modelId;
        clock += 400;
        push({ type: "model_change", provider, modelId } as never);
        break;
      case "thinking":
        clock += 200;
        push({ type: "thinking_level_change", thinkingLevel: step.level } as never);
        break;
      case "tools":
        clock += 200;
        push({ type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: step.tools } } as never);
        break;
      case "user": {
        clock += (step.gapMinutes ?? 0.6) * 60_000;
        const text = t(step.text);
        contextTokens += estimateTokens(text);
        message({ role: "user", content: [{ type: "text", text }], timestamp: clock });
        break;
      }
      case "assistant":
        for (let index = 0; index < step.rounds.length; index++) {
          await assistantRound(step.rounds[index]);
        }
        break;
      case "bash": {
        clock += (step.gapMinutes ?? 0.5) * 60_000;
        contextTokens += estimateTokens(step.output);
        message({
          role: "bashExecution",
          command: step.command,
          output: step.output,
          exitCode: step.exitCode ?? 0,
          cancelled: false,
          truncated: false,
          ...(step.excludeFromContext ? { excludeFromContext: true } : {}),
          timestamp: clock,
        } as never);
        break;
      }
      case "compaction": {
        clock += 20_000;
        const firstKept = parentId ?? "";
        push({ type: "compaction", summary: t(step.summary), firstKeptEntryId: firstKept, tokensBefore: step.tokensBefore } as never);
        contextTokens = 9_400 + estimateTokens(t(step.summary));
        break;
      }
      case "custom":
        clock += 1000;
        push({ type: "custom_message", customType: step.customType, content: t(step.content), display: true, ...(step.details !== undefined ? { details: step.details } : {}) } as never);
        break;
      case "mark":
        if (parentId) marks.set(step.name, parentId);
        break;
      case "rewind": {
        const target = marks.get(step.to);
        if (!target) throw new Error(`Unknown mark ${step.to}`);
        parentId = target;
        clock += (step.gapMinutes ?? 2) * 60_000;
        break;
      }
    }
  }

  const leafId = script.leaf ? marks.get(script.leaf) ?? parentId : parentId;
  return { entries, leafId };
}
