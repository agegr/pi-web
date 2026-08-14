import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("session info panel has an explicit close action", () => {
  assert.match(source, /className="session-info-popover"[\s\S]*?aria-label=\{translate\("i18n\.close"\)\}[\s\S]*?onClick=\{\(\) => closeTopPanel\(\)\}/);
  assert.match(source, /<X size=\{14\}/);
});

test("top panel closes on Escape and outside pointer and restores focus", () => {
  assert.match(source, /const closeTopPanel = useCallback/);
  assert.match(source, /topPanelReturnFocusRef\.current\?\.focus/);
  assert.match(source, /document\.addEventListener\("keydown",[\s\S]*?event\.key !== "Escape"[\s\S]*?closeTopPanel\(\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(source, /const handlePointerDown = \(event: PointerEvent\) => \{[\s\S]*?topPanelRef\.current\?\.contains/);
  assert.match(source, /const openSessionStatsPanel = useCallback[\s\S]*?topPanelReturnFocusRef\.current = document\.activeElement/);
});

test("session info close control meets touch target size", () => {
  assert.doesNotMatch(source, /className="session-info-close"[\s\S]*?width: 28,[\s\S]*?height: 28,/);
  assert.match(source, /\.session-info-close\s*\{[\s\S]*?width: 28px;[\s\S]*?height: 28px;/);
  assert.match(source, /@media \(pointer: coarse\)[\s\S]*?\.session-info-close[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
});
test("session info copy controls carry accessible labels", () => {
  assert.match(source, /aria-label=\{copied \? translate\("session\.copied"\) : translate\(field === "file" \? "session\.copyFile" : "session\.copyId"\)\}/);
});
