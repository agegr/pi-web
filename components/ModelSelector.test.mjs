import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("does not autofocus the model filter on mobile", () => {
  // Autofocus would open the on-screen keyboard as soon as the picker opens.
  assert.match(source, /aria-label=\{t\("chat\.filterModels"\)\}[\s\S]*?autoFocus=\{!isMobile\}/);
  assert.doesNotMatch(source, /^\s*autoFocus\s*$/m);
});

test("keeps the server's model order (#783)", () => {
  // /api/models already returns pi's /model order; sorting by name here would
  // scatter a models.json provider's hand-ordered models again.
  assert.doesNotMatch(source, /\.sort\(/);
});
