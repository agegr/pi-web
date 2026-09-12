import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const stats = source.slice(source.indexOf("const renderSessionStatsButton"));

test("reports the session message count alongside tokens and context", () => {
  assert.match(stats, /const totalMessages = sessionStats\?\.totalMessages \?\? 0;/);
  // Hidden for an empty session, so a new chat keeps the same header as before.
  assert.match(stats, /\{totalMessages > 0 && \(\s*<span/);
  assert.match(stats, /\{formatCompact\(totalMessages\)\}/);
  assert.match(stats, /if \(totalMessages > 0\) tooltipParts\.push\(`messages: \$\{totalMessages\.toLocaleString\(locale\)\}`\)/);
});

test("warns before a session grows large enough to slow switching", () => {
  assert.match(stats, /totalMessages > 5000\s*\?\s*"#ef4444"/);
  assert.match(stats, /totalMessages > 2000\s*\?\s*"rgba\(234,179,8,0\.95\)"/);
  // Same thresholds and colours the context gauge already uses.
  assert.match(stats, /percent > 90\) contextColor = "#ef4444"/);
  assert.match(stats, /percent > 70\) contextColor = "rgba\(234,179,8,0\.95\)"/);
});
