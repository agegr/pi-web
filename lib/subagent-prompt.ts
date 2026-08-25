export interface SubagentPromptPlan {
  chatOnly: boolean;
  appendSystemPrompt: string[];
  delegatedTask: string;
  exactSystemPrompt?: string;
}

export function buildSubagentPromptPlan(options: {
  profileSystemPrompt: string;
  tools: readonly string[];
  loadSkills?: boolean;
  loadExtensions?: boolean;
  task: string;
  inheritedParentContext?: string;
}): SubagentPromptPlan {
  const chatOnly = options.tools.length === 0 && !options.loadSkills && !options.loadExtensions;
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
    ...(chatOnly ? { exactSystemPrompt: options.profileSystemPrompt } : {}),
  };
}
