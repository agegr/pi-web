import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  CHAT_ONLY_RESOURCE_LOADER_OPTIONS,
  contextFilesSystemPrompt,
} = await createJiti(import.meta.url).import("./chat-only.ts");

test("Chat only disables optional resources but retains Pi context discovery", () => {
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noExtensions, true);
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noSkills, true);
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noPromptTemplates, true);
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noThemes, true);
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noContextFiles, false);
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.systemPromptOverride("configured"), undefined);
  assert.deepEqual(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.appendSystemPromptOverride(["configured"]), []);
});

test("Chat only preserves Pi context-file order without filtering CLAUDE files", () => {
  const prompt = contextFilesSystemPrompt([
    { path: "/global/AGENTS.md", content: "global agents" },
    { path: "/repo/CLAUDE.md", content: "project claude" },
    { path: "/repo/app/AGENTS.override.md", content: "nested override" },
  ]);
  assert.equal(prompt, "global agents\n\nproject claude\n\nnested override");
});
