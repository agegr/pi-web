import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useTheme.ts", import.meta.url), "utf8");

test("exports color theme type and helpers", () => {
  assert.match(source, /export type ColorTheme/);
  assert.match(source, /const COLOR_THEMES/);
  assert.match(source, /function getColorThemeSnapshot/);
  assert.match(source, /function getColorThemeServerSnapshot/);
  assert.match(source, /const setColorTheme = useCallback/);
  assert.match(source, /colorTheme, setColorTheme/);
});

test("setColorTheme sets DOM attribute and persists to localStorage", () => {
  const snippet = source.slice(source.indexOf("const setColorTheme = useCallback"));
  assert.match(snippet, /setAttribute\("data-theme", next\)/);
  assert.match(snippet, /localStorage\.setItem\("pi-color-theme", next\)/);
  assert.match(snippet, /listeners\.forEach\(\(cb\) => cb\(\)\);/);
});

test("getColorThemeSnapshot falls back to default for unknown values", () => {
  assert.match(source, /return "default";/);
  assert.match(source, /COLOR_THEMES\.includes\(attr\)/);
});
