import type { AgentMessage } from "./types";

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string; progress?: string }[] }
  | null;

export function phaseAfterMessage(phase: AgentPhase, message: AgentMessage | undefined): AgentPhase {
  if (message?.role !== "assistant") return phase;

  const tools = message.content.flatMap((block) =>
    block.type === "toolCall"
      ? [{ id: block.toolCallId, name: block.toolName }]
      : []
  );
  return tools.length > 0 ? { kind: "running_tools", tools } : { kind: "waiting_model" };
}

export function addRunningTool(phase: AgentPhase, id: string, name: string): AgentPhase {
  const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
  if (!tools.some((tool) => tool.id === id)) tools.push({ id, name });
  return { kind: "running_tools", tools };
}

export function updateRunningTool(
  phase: AgentPhase,
  id: string,
  name: string,
  progress?: string | null,
): AgentPhase {
  const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
  const existing = tools.find((tool) => tool.id === id);
  const updated = {
    id,
    name: name || existing?.name || "tool",
    progress: progress ?? existing?.progress,
  };
  return {
    kind: "running_tools",
    tools: [...tools.filter((tool) => tool.id !== id), updated],
  };
}

export function endRunningTool(phase: AgentPhase, id: string): AgentPhase {
  if (phase?.kind !== "running_tools") return phase;
  const tools = phase.tools.filter((tool) => tool.id !== id);
  return tools.length === 0 ? { kind: "waiting_model" } : { kind: "running_tools", tools };
}
