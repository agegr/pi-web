import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [helperSource, globalCss, editorCss] = await Promise.all([
  readFile(new URL("./location-highlight.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../components/markdown-editor.css", import.meta.url), "utf8"),
]);

test("preview location highlight uses the runtime class in both preview surfaces", () => {
  assert.match(helperSource, /LOCATION_HIGHLIGHT_CLASS\s*=\s*["']location-highlight["']/);
  assert.match(globalCss, /\.location-highlight\s*(?:,|\{)/);
  assert.match(editorCss, /\.markdown-editable\s*>\s*\.location-highlight\s*(?:,|\{)/);
});
