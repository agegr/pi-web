import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { filterSlashCommands } = await jiti.import("./ChatInput.tsx");

const t = (key) => key;
const names = (commands) => commands.map((command) => command.name);

const commands = [
  { name: "copy", description: "Copy the last assistant message", source: "builtin" },
  { name: "compact", description: "Compact the context", source: "builtin" },
  { name: "skill:better-writing", description: "Polish UI product copy", source: "skill" },
  { name: "skill:copy-text", description: "Copy text", source: "skill" },
  { name: "skill:deep-copy", description: "Clone objects", source: "skill" },
  { name: "daily-brief", description: "Prepare an assistant brief", source: "prompt" },
];

test("names decide: a description match is dropped while any name matches (#1413)", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "copy", t)), ["copy", "skill:copy-text", "skill:deep-copy"]);
});

test("a skill matches by its bare name, and by its full name with the prefix typed", () => {
  // Bare-name prefix (rank 1) comes before a plain substring (rank 2), like pi's TUI.
  assert.deepEqual(names(filterSlashCommands(commands.slice(2), "copy", t)), ["skill:copy-text", "skill:deep-copy"]);
  assert.deepEqual(names(filterSlashCommands(commands, "skill:copy", t)), ["skill:copy-text"]);
  assert.deepEqual(names(filterSlashCommands(commands, "better-writing", t)), ["skill:better-writing"]);
});

test("descriptions are searched only when no name matches", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "assistant", t)), ["copy", "daily-brief"]);
});

test("an empty query lists everything by source, then name", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "", t)), [
    "compact",
    "copy",
    "daily-brief",
    "skill:better-writing",
    "skill:copy-text",
    "skill:deep-copy",
  ]);
});
