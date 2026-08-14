import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");
const models = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./CodexSidebar.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("directory picker uses the shared native tool dialog", () => {
  assert.match(directory, /<DialogShell[\s\S]*?size="tool"/);
  assert.match(directory, /bodyClassName="codex-dialog-tool-body directory-picker-panel"/);
  assert.match(directory, /directory-picker-footer/);
});

test("provider picker uses the shared tool dimensions and close chrome", () => {
  assert.match(models, /className="codex-dialog models-picker"/);
  assert.match(models, /data-size="tool"/);
  assert.match(models, /models-picker-close/);
});

test("quick switcher uses shared tool dimensions without changing keyboard navigation", () => {
  assert.match(sidebar, /className="codex-dialog codex-quick-switcher"/);
  assert.match(sidebar, /data-size="tool"/);
  assert.match(sidebar, /event\.key === "ArrowDown"/);
  assert.match(sidebar, /event\.key === "ArrowUp"/);
  assert.match(sidebar, /event\.key === "Enter"/);
});

test("directory picker reports errors with role=alert and keeps Escape from closing mid-create", () => {
  assert.match(directory, /role="alert"/);
  assert.match(directory, /if \(event\.key !== "Escape"\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/);
  assert.match(directory, /if \(creatingFolder\) return;[\s\S]*?setNewFolderOpen\(false\);/);
});

test("tool dialog content fills the shared shell and mobile viewport", () => {
  assert.match(styles, /\.codex-dialog-tool-body\s*\{[\s\S]*?padding:\s*0;[\s\S]*?display:\s*flex;/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.codex-dialog\[data-size="tool"\][\s\S]*?height:\s*100dvh/);
  assert.doesNotMatch(styles, /\.codex-quick-switcher::backdrop\s*\{[^}]*backdrop-filter/);
  assert.doesNotMatch(styles, /\.codex-quick-switcher\s*\{[^}]*0 20px 60px/);
});
