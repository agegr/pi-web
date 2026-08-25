export interface ContextFileContent {
  path: string;
  content: string;
}

export const CHAT_ONLY_RESOURCE_LOADER_OPTIONS = {
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: false,
  // Truthy placeholders prevent the loader from discovering configured prompt
  // files. The overrides ensure neither placeholder participates in the prompt.
  systemPrompt: " ",
  appendSystemPrompt: [" "],
  systemPromptOverride: () => undefined,
  appendSystemPromptOverride: () => [],
};

/** Preserve Pi's discovery order and include only the context-file contents. */
export function contextFilesSystemPrompt(files: readonly ContextFileContent[]): string {
  return files.map((file) => file.content).join("\n\n");
}
