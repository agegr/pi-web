export interface SubagentPromptPlan {
  chatOnly: boolean;
  appendSystemPrompt: string[];
  delegatedTask: string;
  exactSystemPrompt?: string;
}

/**
 * The exact prompt a chat-only or replace-mode subagent sends: the profile body,
 * followed by whatever skill text the caller resolved for it.
 *
 * `skillText` is passed as a string rather than pre-baked into the plan because
 * both callers resolve it per run — see subagentSkillPromptText().
 */
export function composeSubagentExactPrompt(
  profileSystemPrompt: string,
  skillText = "",
): string {
  return [profileSystemPrompt, skillText].filter(Boolean).join("\n\n");
}

export function buildSubagentPromptPlan(options: {
  profileSystemPrompt: string;
  tools: readonly string[];
  loadSkills?: boolean;
  loadExtensions?: boolean;
  promptMode?: "replace" | "append";
  task: string;
  inheritedParentContext?: string;
}): SubagentPromptPlan {
  const chatOnly = options.tools.length === 0 && !options.loadSkills && !options.loadExtensions;
  const replacePrompt = options.promptMode === "replace";
  const appendSystemPrompt = [options.profileSystemPrompt];
  if (options.inheritedParentContext && !chatOnly) {
    appendSystemPrompt.push(options.inheritedParentContext);
  }

  return {
    chatOnly,
    appendSystemPrompt,
    delegatedTask: options.inheritedParentContext && chatOnly
      ? `${options.task}\n\n${options.inheritedParentContext}`
      : options.task,
    ...(chatOnly || replacePrompt
      ? { exactSystemPrompt: composeSubagentExactPrompt(options.profileSystemPrompt) }
      : {}),
  };
}
