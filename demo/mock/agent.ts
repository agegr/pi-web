/**
 * Stand-in for lib/rpc-manager.ts: one "agent" per session that answers
 * /api/agent commands and streams canned replies over the mock SSE channel
 * with the same event sequence a real pi run produces.
 */
import type { AgentMessage, AssistantMessage, SessionEntry, ToolResultMessage } from "@/lib/types";
import type { MockEventSource } from "./event-source";
import { currentDemoLocale } from "./locale";
import { delay } from "./http";
import { readProjectText } from "./files";
import { PROJECT_ROOT } from "./paths";
import { SYSTEM_PROMPT_TEMPLATE } from "./system-prompt";
import toolsCatalog from "./captured/tools.json";
import commandsCatalog from "./captured/commands.json";
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL, MODEL_API, contextWindowFor, modelExists } from "./data/models";
import { estimateTokens, readToolOutput, usageFor } from "./sessions/builder";
import {
  addSession,
  appendEntry,
  buildContext,
  getSession,
  markTouched,
  projectRootFor,
  randomUuid,
  type LiveState,
  type MockSession,
} from "./sessions/store";
import { readSessionToolSelectionFromEntries } from "./sessions/tool-selection";
import { composeReply, type ReplyPlan } from "./replies";
import { runShellCommand } from "./shell";
import { settings } from "./settings-state";

// ---------------------------------------------------------------------------
// Event streams
// ---------------------------------------------------------------------------

const streams = new Map<string, Set<MockEventSource>>();

function emit(sessionId: string, event: Record<string, unknown>): void {
  for (const source of streams.get(sessionId) ?? []) source.send(event);
}

export function attachAgentStream(sessionId: string, source: MockEventSource): (() => void) | void {
  const session = getSession(sessionId);
  if (!session) {
    source.fail();
    return;
  }
  const live = ensureLive(session);
  let set = streams.get(sessionId);
  if (!set) streams.set(sessionId, set = new Set());
  set.add(source);
  source.send({ type: "connected", sessionId, isStreaming: live.running });
  if (live.streamingMessage) source.send({ type: "message_start", message: live.streamingMessage });
  return () => {
    set!.delete(source);
  };
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export function ensureLive(session: MockSession): LiveState {
  if (!session.live) {
    const context = buildContext(session, session.leafId, { tail: 0 });
    session.live = {
      model: context.model && modelExists(context.model.provider, context.model.modelId) ? context.model : { ...DEFAULT_MODEL },
      thinkingLevel: context.thinkingLevel && context.thinkingLevel !== "off" ? context.thinkingLevel : DEFAULT_THINKING_LEVEL,
      running: false,
      streamingMessage: null,
      autoCompactionEnabled: true,
    };
  }
  return session.live;
}

export function runningSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id] of streams) {
    const session = getSession(id);
    if (session?.live?.running) ids.push(id);
  }
  return ids;
}

function lastAssistantUsage(session: MockSession): number | null {
  const context = buildContext(session, session.leafId, { tail: 0 });
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index];
    if (message.role === "assistant" && message.usage) {
      return message.usage.input + message.usage.cacheRead + message.usage.output;
    }
  }
  return null;
}

async function systemPromptFor(session: MockSession): Promise<string> {
  const toolNames = readSessionToolSelectionFromEntries(session.entries);
  if (toolNames && toolNames.length === 0) return "";
  const root = projectRootFor(session.cwd);
  let prompt = SYSTEM_PROMPT_TEMPLATE;
  if (root === PROJECT_ROOT) {
    const agents = await readProjectText(`${PROJECT_ROOT}/AGENTS.md`).catch(() => null);
    prompt = prompt.replace("{{AGENTS_MD}}", agents ?? "");
  } else {
    prompt = prompt.replace(/\n\n<project_context>[\s\S]*?<\/project_context>/, "");
  }
  return prompt.replaceAll(PROJECT_ROOT, session.cwd);
}

export async function agentState(session: MockSession) {
  const live = ensureLive(session);
  const tokens = lastAssistantUsage(session);
  const contextWindow = contextWindowFor(live.model.provider, live.model.modelId);
  return {
    sessionId: session.id,
    sessionFile: "",
    isStreaming: live.running,
    isPromptRunning: live.running,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: live.autoCompactionEnabled,
    autoRetryEnabled: true,
    model: { id: live.model.modelId, provider: live.model.provider },
    messageCount: 0,
    pendingMessageCount: 0,
    queuedMessages: { steering: [], followUp: [] },
    contextUsage: tokens === null
      ? { percent: null, contextWindow, tokens: null }
      : { percent: (tokens / contextWindow) * 100, contextWindow, tokens },
    systemPrompt: await systemPromptFor(session),
    thinkingLevel: live.thinkingLevel,
    extensionStatuses: [],
    extensionWidgets: [],
  };
}

export function toolsFor(session: MockSession) {
  const pinned = readSessionToolSelectionFromEntries(session.entries);
  const defaults = new Set(["read", "bash", "edit", "write", "Agent", "get_subagent_result", "steer_subagent"]);
  return toolsCatalog
    .filter((tool) => settings.subagentsEnabled || !["Agent", "get_subagent_result", "steer_subagent"].includes(tool.name))
    .map((tool) => ({
      ...tool,
      active: pinned
        ? pinned.includes(tool.name) || (pinned.length > 0 && ["Agent", "get_subagent_result", "steer_subagent"].includes(tool.name))
        : defaults.has(tool.name),
    }));
}

// ---------------------------------------------------------------------------
// Session copies (fork / clone)
// ---------------------------------------------------------------------------

function branchTo(session: MockSession, entryId: string | null): SessionEntry[] {
  if (!entryId) return [];
  const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
  const chain: SessionEntry[] = [];
  let current = byId.get(entryId);
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse().map((entry) => structuredClone(entry));
}

function copySession(source: MockSession, upTo: string | null): MockSession {
  const entries = branchTo(source, upTo);
  const copy: MockSession = {
    id: randomUuid(),
    cwd: source.cwd,
    created: new Date().toISOString(),
    parentSessionId: source.id,
    relation: { kind: "fork", originSessionId: source.id },
    entries,
    leafId: entries.at(-1)?.id ?? null,
    transient: false,
    live: null,
  };
  addSession(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// Prompt simulation
// ---------------------------------------------------------------------------

function assistantShell(session: MockSession): AssistantMessage {
  const live = ensureLive(session);
  return {
    role: "assistant",
    content: [],
    api: MODEL_API[live.model.provider] ?? "openai-completions",
    provider: live.model.provider,
    model: live.model.modelId,
    usage: usageFor(live.model.provider, live.model.modelId, 0, 0, 0),
    stopReason: "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
}

function chunks(text: string): string[] {
  const size = Math.max(3, Math.ceil(text.length / 140));
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts;
}

async function streamAssistant(
  session: MockSession,
  plan: { thinking?: string; text?: string; tool?: { id: string; name: string; args: Record<string, unknown> } },
  contextTokens: number,
): Promise<AssistantMessage> {
  const live = ensureLive(session);
  const message = assistantShell(session);
  live.streamingMessage = message;
  emit(session.id, { type: "message_start", message: structuredClone(message) });
  await delay(350);
  const content: AssistantMessage["content"] = [];
  const update = (assistantMessageEvent: Record<string, unknown>) => emit(session.id, { type: "message_update", assistantMessageEvent });

  if (plan.thinking) {
    const index = content.length;
    content.push({ type: "thinking", thinking: "" });
    update({ type: "thinking_start", contentIndex: index });
    for (const part of chunks(plan.thinking)) {
      (content[index] as { thinking: string }).thinking += part;
      update({ type: "thinking_delta", contentIndex: index, delta: part });
      await delay(18);
    }
    update({ type: "thinking_end", contentIndex: index, content: plan.thinking });
    await delay(200);
  }
  if (plan.text) {
    const index = content.length;
    content.push({ type: "text", text: "" });
    update({ type: "text_start", contentIndex: index });
    for (const part of chunks(plan.text)) {
      (content[index] as { text: string }).text += part;
      update({ type: "text_delta", contentIndex: index, delta: part });
      await delay(22);
    }
    update({ type: "text_end", contentIndex: index, content: plan.text });
  }
  if (plan.tool) {
    const index = content.length;
    const json = JSON.stringify(plan.tool.args);
    update({ type: "toolcall_start", contentIndex: index, id: plan.tool.id, toolName: plan.tool.name });
    for (const part of chunks(json)) {
      update({ type: "toolcall_delta", contentIndex: index, delta: part, id: plan.tool.id, toolName: plan.tool.name });
      await delay(12);
    }
    const toolCall = { id: plan.tool.id, name: plan.tool.name, arguments: plan.tool.args };
    update({ type: "toolcall_end", contentIndex: index, toolCall });
    content.push({ type: "toolCall", id: plan.tool.id, name: plan.tool.name, arguments: plan.tool.args } as never);
  }

  const output = estimateTokens(JSON.stringify(content));
  const cacheRead = Math.round(contextTokens * 0.9);
  const finished = {
    ...message,
    content,
    usage: usageFor(live.model.provider, live.model.modelId, contextTokens - cacheRead, output, cacheRead),
    stopReason: plan.tool ? "toolUse" : "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
  appendEntry(session, { type: "message", message: finished });
  live.streamingMessage = null;
  emit(session.id, { type: "message_end", message: finished });
  return finished;
}

async function resolvePlanToolResult(session: MockSession, plan: ReplyPlan): Promise<string> {
  const tool = plan.tool!;
  if (tool.readFile) {
    const root = projectRootFor(session.cwd);
    const content = await readProjectText(`${root}/${tool.readFile}`).catch(() => null);
    return content === null ? `ENOENT: no such file or directory, open '${tool.readFile}'` : readToolOutput(content, undefined, tool.limit);
  }
  if (tool.name === "bash" && typeof tool.args.command === "string") {
    return (await runShellCommand(tool.args.command, session.cwd)).output || "(no output)";
  }
  return tool.result ?? "(no output)";
}

let toolCallCounter = 0;

async function runPrompt(session: MockSession, text: string): Promise<void> {
  const live = ensureLive(session);
  live.running = true;
  markTouched();
  try {
    emit(session.id, { type: "agent_start" });
    const user: AgentMessage = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
    appendEntry(session, { type: "message", message: user });
    emit(session.id, { type: "message_start", message: user });
    emit(session.id, { type: "message_end", message: user });
    await delay(500);

    const plan = composeReply(text, currentDemoLocale(), session);
    let contextTokens = (lastAssistantUsage(session) ?? 9_400) + estimateTokens(text);
    if (plan.tool) {
      const id = `call_demo${++toolCallCounter}`;
      await streamAssistant(session, { thinking: plan.thinking, text: plan.preface, tool: { id, name: plan.tool.name, args: plan.tool.args } }, contextTokens);
      emit(session.id, { type: "tool_execution_start", toolCallId: id, toolName: plan.tool.name, args: plan.tool.args });
      const output = await resolvePlanToolResult(session, plan);
      await delay(700);
      const result: ToolResultMessage = {
        role: "toolResult",
        toolCallId: id,
        toolName: plan.tool.name,
        content: [{ type: "text", text: output }],
        isError: false,
        timestamp: Date.now(),
      };
      emit(session.id, { type: "tool_execution_end", toolCallId: id, toolName: plan.tool.name, result: { content: result.content }, isError: false });
      appendEntry(session, { type: "message", message: result });
      emit(session.id, { type: "message_start", message: result });
      emit(session.id, { type: "message_end", message: result });
      contextTokens += estimateTokens(output) + 200;
      await delay(300);
      await streamAssistant(session, { text: plan.text }, contextTokens);
    } else {
      await streamAssistant(session, { thinking: plan.thinking, text: plan.text }, contextTokens);
    }
  } finally {
    live.running = false;
    live.streamingMessage = null;
    emit(session.id, { type: "agent_end" });
    await delay(30);
    emit(session.id, { type: "agent_settled" });
    emit(session.id, { type: "prompt_done" });
  }
}

// ---------------------------------------------------------------------------
// Command dispatcher (POST /api/agent/[id])
// ---------------------------------------------------------------------------

export type CommandResult = { ok: true; data: unknown } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

const ok = (data: unknown = null): CommandResult => ({ ok: true, data });
const fail = (error: string, status = 400, extra?: Record<string, unknown>): CommandResult => ({ ok: false, status, error, extra });

export async function runAgentCommand(session: MockSession, command: Record<string, unknown>): Promise<CommandResult> {
  const live = ensureLive(session);
  switch (command.type) {
    case "prompt": {
      if (live.running) return fail("Agent is already running", 409, { code: "prompt_rejected", accepted: false });
      const message = typeof command.message === "string" ? command.message : "";
      void runPrompt(session, message);
      return ok(null);
    }
    case "steer":
    case "follow_up":
      return ok(null);
    case "abort":
    case "abort_bash":
    case "abort_compaction":
    case "extension_ui_response":
    case "extension_ui_input":
    case "set_auto_retry":
      return ok(null);
    case "get_state":
      return ok(await agentState(session));
    case "get_tools":
      return ok(toolsFor(session));
    case "get_commands":
      return ok(commandsCatalog);
    case "set_model": {
      const provider = String(command.provider ?? "");
      const modelId = String(command.modelId ?? "");
      if (!modelExists(provider, modelId)) return fail(`Model not found: ${provider}/${modelId}`, 500);
      live.model = { provider, modelId };
      if (session.entries.length > 0 || !session.transient) appendEntry(session, { type: "model_change", provider, modelId });
      return ok({ id: modelId, provider });
    }
    case "set_thinking_level": {
      live.thinkingLevel = String(command.level ?? "off");
      if (session.entries.length > 0) appendEntry(session, { type: "thinking_level_change", thinkingLevel: live.thinkingLevel });
      return ok(null);
    }
    case "set_tools": {
      const toolNames = Array.isArray(command.toolNames) ? command.toolNames as string[] : [];
      appendEntry(session, { type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: toolNames } });
      return ok({ sessionId: session.id, recreated: false });
    }
    case "set_session_name": {
      const name = String(command.name ?? "").trim();
      if (!name) return fail("Session name cannot be empty", 500);
      session.name = name;
      appendEntry(session, { type: "session_info", name });
      return ok(null);
    }
    case "set_auto_compaction":
      live.autoCompactionEnabled = Boolean(command.enabled);
      return ok(null);
    case "clear_queue":
      return ok({ steering: [], followUp: [] });
    case "reload":
      return ok({ success: true });
    case "navigate_tree": {
      const targetId = String(command.targetId ?? "");
      const target = session.entries.find((entry) => entry.id === targetId);
      if (!target) return fail(`Entry ${targetId} not found`, 500);
      const isUser = target.type === "message" && target.message.role === "user";
      session.leafId = isUser ? target.parentId : target.id;
      markTouched();
      return ok({ cancelled: false });
    }
    case "fork": {
      const entry = session.entries.find((candidate) => candidate.id === command.entryId);
      if (!entry) return fail("Invalid entry ID for forking", 500);
      return ok({ cancelled: false, newSessionId: copySession(session, entry.parentId).id });
    }
    case "fork_branch": {
      const entry = session.entries.find((candidate) => candidate.id === command.entryId);
      if (!entry) return fail("Invalid entry ID for forking", 500);
      return ok({ cancelled: false, newSessionId: copySession(session, entry.id).id });
    }
    case "clone": {
      const leafId = typeof command.leafId === "string" ? command.leafId : session.leafId;
      return ok({ cancelled: false, newSessionId: copySession(session, leafId).id });
    }
    case "compact": {
      const tokensBefore = lastAssistantUsage(session) ?? 12_000;
      const summary = currentDemoLocale() === "zh"
        ? "## 目标\n通过对话熟悉 Pi Web 的界面和功能。\n\n## 进展\n- 已浏览会话列表、文件浏览器和模型设置\n- 已了解分支、工具调用和斜杠命令\n\n## 下一步\n- 继续在演示中探索，或运行 `npx @agegr/pi-web@latest` 连接真实的 pi agent"
        : "## Goal\nLearn Pi Web's layout and features through conversation.\n\n## Progress\n- Toured the session list, file explorer and model settings\n- Covered branching, tool calls and slash commands\n\n## Next steps\n- Keep exploring the demo, or run `npx @agegr/pi-web@latest` to connect a real pi agent";
      appendEntry(session, { type: "compaction", summary, firstKeptEntryId: session.leafId ?? "", tokensBefore });
      return ok({ tokensBefore, estimatedTokensAfter: 9_400 + estimateTokens(summary) });
    }
    case "get_session_stats": {
      const { computeSessionStats } = await import("@/lib/session-stats");
      const stats = computeSessionStats(session.entries);
      const state = await agentState(session);
      return ok({ ...stats, sessionId: session.id, sessionName: session.name, contextUsage: state.contextUsage });
    }
    case "get_last_assistant_text": {
      const context = buildContext(session, session.leafId, { tail: 0 });
      const last = [...context.messages].reverse().find((message) => message.role === "assistant") as AssistantMessage | undefined;
      const text = last?.content.filter((block) => block.type === "text").map((block) => (block as { text: string }).text).join("\n") ?? "";
      return ok({ text });
    }
    case "bash": {
      const commandText = String(command.command ?? "");
      const result = await runShellCommand(commandText, session.cwd);
      appendEntry(session, {
        type: "message",
        message: {
          role: "bashExecution",
          command: commandText,
          output: result.output,
          exitCode: result.exitCode,
          cancelled: false,
          truncated: false,
          ...(command.excludeFromContext ? { excludeFromContext: true } : {}),
          timestamp: Date.now(),
        },
      });
      return ok({ output: result.output, exitCode: result.exitCode, cancelled: false, truncated: false });
    }
    default:
      return fail(`Unsupported command: ${String(command.type)}`, 500);
  }
}

/** POST /api/agent/new — create an empty runtime session in `cwd`. */
export function createRuntimeSession(body: Record<string, unknown>) {
  const cwd = String(body.cwd ?? PROJECT_ROOT);
  const provider = typeof body.provider === "string" ? body.provider : DEFAULT_MODEL.provider;
  const modelId = typeof body.modelId === "string" ? body.modelId : DEFAULT_MODEL.modelId;
  const model = modelExists(provider, modelId) ? { provider, modelId } : { ...DEFAULT_MODEL };
  const thinkingLevel = typeof body.thinkingLevel === "string" ? body.thinkingLevel : DEFAULT_THINKING_LEVEL;
  const session: MockSession = {
    id: randomUuid(),
    cwd,
    created: new Date().toISOString(),
    entries: [],
    leafId: null,
    transient: true,
    live: { model, thinkingLevel, running: false, streamingMessage: null, autoCompactionEnabled: true },
  };
  addSession(session);
  appendEntry(session, { type: "model_change", provider: model.provider, modelId: model.modelId });
  appendEntry(session, { type: "thinking_level_change", thinkingLevel });
  if (Array.isArray(body.toolNames)) {
    appendEntry(session, { type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: body.toolNames } });
  }
  session.transient = true;
  return { success: true, sessionId: session.id, data: null, model, thinkingLevel };
}
