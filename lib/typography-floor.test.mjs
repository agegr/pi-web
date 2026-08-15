import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FILES = ["app/globals.css", "components/ChatMinimap.module.css"];
const BANNED = /\bfont-size:\s*(9|9\.5|10|10\.5|11)px\b/;
const RAW_PX = /\bfont-size:\s*(\d+(?:\.\d+)?)px\b/;
const FONT_SHORTHAND = /\bfont:\s*[^;]*\b(9|9\.5|10|10\.5|11)px\b/;

function linesOf(rel) {
  return readFileSync(join(process.cwd(), rel), "utf8").split("\n").map((text, i) => ({
    file: rel,
    line: i + 1,
    text,
  }));
}

function isAllowed16(line) {
  return /\bfont-size:\s*16px\b/.test(line.text);
}

test("product CSS has no type below 12px", () => {
  const hits = FILES.flatMap(linesOf).filter((row) => BANNED.test(row.text) || FONT_SHORTHAND.test(row.text));
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});

test("product CSS font-size uses tokens except the 16px input exception", () => {
  const hits = FILES.flatMap(linesOf).filter((row) => RAW_PX.test(row.text) && !isAllowed16(row));
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});

const TSX_FILES = [
  "components/AppShell.tsx",
  "components/ChatWindow.tsx",
  "components/ChatInput.tsx",
  "components/MessageView.tsx",
  "components/SubagentSessions.tsx",
  "components/DirectoryPicker.tsx",
  "components/ModelsConfig.tsx",
  "components/SkillsConfig.tsx",
  "components/PluginsConfig.tsx",
  "components/FileViewer.tsx",
  "components/TabBar.tsx",
  "components/FileExplorer.tsx",
  "components/BranchNavigator.tsx",
  "components/TurnWrittenFiles.tsx",
  "components/MermaidBlock.tsx",
];

const INLINE_PX = /\bfontSize:\s*(\d+(?:\.\d+)?)\b/;

test("product TSX has no numeric fontSize below 12", () => {
  const hits = TSX_FILES.flatMap(linesOf).filter((row) => {
    const match = row.text.match(INLINE_PX);
    return match && Number(match[1]) < 12;
  });
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});

test("product TSX fontSize uses tokens", () => {
  const hits = TSX_FILES.flatMap(linesOf).filter((row) => INLINE_PX.test(row.text));
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.text.trim()}`).join("\n"));
});
