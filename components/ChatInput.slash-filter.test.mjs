import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { filterSlashCommands, slashPaletteCommands } = await jiti.import("./ChatInput.tsx");

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

test("an extension command named as a built-in that answers here is left out, as pi's autocomplete does", () => {
  const session = [
    { name: "model", description: "Extension model", source: "extension" },
    { name: "compact", description: "Extension compact", source: "extension" },
    { name: "new", description: "Extension new", source: "extension" },
    { name: "model:2", description: "A second extension's /model", source: "extension" },
    { name: "export", description: "A prompt template", source: "prompt" },
  ];
  const main = { isStreaming: false, pageCommands: true, modelPicker: true, thinkingMenu: true };
  const extensionNames = (context) => names(slashPaletteCommands(session, context).filter((command) => command.source !== "builtin"));
  const builtinNames = (context) => names(slashPaletteCommands(session, context).filter((command) => command.source === "builtin"));

  // The main chat, idle: the built-ins run, so only the renamed command and the prompt stay.
  assert.deepEqual(extensionNames(main), ["model:2", "export"]);
  // While a run streams /compact is sent to pi, where the extension's runs.
  assert.deepEqual(extensionNames({ ...main, isStreaming: true }), ["compact", "model:2", "export"]);
  assert.equal(builtinNames({ ...main, isStreaming: true }).includes("compact"), false);
  // A tab's chat has no page commands: its /new is the extension's.
  assert.deepEqual(extensionNames({ ...main, pageCommands: false }), ["new", "model:2", "export"]);
  assert.equal(builtinNames({ ...main, pageCommands: false }).includes("new"), false);
  // Without the composer's picker, /model is not the built-in either.
  assert.deepEqual(extensionNames({ ...main, modelPicker: false }), ["model", "model:2", "export"]);
  assert.equal(builtinNames({ ...main, modelPicker: false }).includes("model"), false);
  assert.equal(builtinNames({ ...main, thinkingMenu: false }).includes("thinking"), false);
});
