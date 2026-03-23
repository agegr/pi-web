/**
 * System prompt used when tools are disabled (preset: off).
 * Edit this file to customize what the agent is told in no-tool mode.
 */

export function buildNoToolsSystemPrompt(_cwd: string): string {
  return `You are a reliable, direct, and practical assistant.
`;
}
