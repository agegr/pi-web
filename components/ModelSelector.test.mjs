import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("does not autofocus the model filter on mobile", () => {
  // Autofocus would open the on-screen keyboard as soon as the picker opens.
  assert.match(source, /aria-label=\{t\("chat\.filterModels"\)\}[\s\S]*?autoFocus=\{!isMobile\}/);
  assert.doesNotMatch(source, /^\s*autoFocus\s*$/m);
});
