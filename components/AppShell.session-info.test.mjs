import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("session info panel has an explicit close action", () => {
  assert.match(source, /className="session-info-popover"[\s\S]*?aria-label=\{translate\("i18n\.close"\)\}[\s\S]*?onClick=\{\(\) => setActiveTopPanel\(null\)\}/);
  assert.match(source, /<X size=\{14\}/);
});
