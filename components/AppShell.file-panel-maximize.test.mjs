import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const english = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const chinese = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("keeps maximize and restore immediately left of the file panel's own toggle", () => {
  const conversationHeaderStart = source.indexOf("{/* Top bar with sidebar toggle */}");
  const conversationHeaderEnd = source.indexOf("{/* Chat content */}", conversationHeaderStart);
  const fileHeaderStart = source.indexOf("{/* Right panel tab bar */}");
  const fileHeaderEnd = source.indexOf("{/* Only the active viewer", fileHeaderStart);
  assert.notEqual(conversationHeaderStart, -1);
  assert.notEqual(conversationHeaderEnd, -1);
  assert.notEqual(fileHeaderStart, -1);
  assert.notEqual(fileHeaderEnd, -1);

  const conversationHeader = source.slice(conversationHeaderStart, conversationHeaderEnd);
  const fileHeader = source.slice(fileHeaderStart, fileHeaderEnd);
  const layoutControl = 'renderFilePanelLayoutButton(rightPanelMaximized ? "restore" : "maximize")';
  assert.doesNotMatch(conversationHeader, /renderFilePanelLayoutButton/);
  assert.ok(fileHeader.includes(layoutControl));
  assert.ok(fileHeader.indexOf(layoutControl) < fileHeader.indexOf("onClick={handleRightPanelClose}"));

  assert.match(source, /data-file-panel-layout-action=\{mode\}/);
  assert.match(english, /"files\.maximizePanel": "Maximize file panel"/);
  assert.match(english, /"files\.restorePanel": "Restore file panel"/);
  assert.match(chinese, /"files\.maximizePanel": "最大化文件面板"/);
  assert.match(chinese, /"files\.restorePanel": "恢复文件面板"/);
});

test("maximized files replace the mounted conversation and expose the sidebar toggle", () => {
  assert.match(source, /className={`conversation-panel\$\{rightPanelMaximized \? " file-panel-maximized" : ""\}`}/);
  assert.match(source, /aria-hidden=\{rightPanelMaximized\}/);
  assert.match(source, /rightPanelMaximized && !isMobile && renderSidebarToggle\("maximized-file"\)/);
  assert.match(source, /right-panel-maximized/);
  assert.match(css, /\.conversation-panel\.file-panel-maximized\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(min-width: 960px\)[\s\S]*?\.right-panel-container\.right-panel-maximized[\s\S]*?flex: 1 1 auto;/);
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 959px\)[\s\S]*?\.right-panel-container\.right-panel-maximized[\s\S]*?position: relative;/);
});

test("maximized layout exits at destructive and responsive boundaries", () => {
  assert.match(source, /const handleRightPanelClose = useCallback\(\(\) => \{\s*setRightPanelMaximized\(false\);\s*setRightPanelOpen\(false\);/);
  assert.match(source, /if \(remaining\.length === 0\) handleRightPanelClose\(\);/);
  assert.match(source, /if \(isMobile\) \{[\s\S]*?setRightPanelMaximized\(false\);[\s\S]*?\}/);
  assert.match(source, /const handleAttentionNeeded = useCallback[\s\S]*?setRightPanelMaximized\(false\);/);
  assert.match(source, /setFileTabs\(\[\]\);\s*setActiveFileTabId\(null\);\s*handleRightPanelClose\(\);/);
});

test("does not show split-layout affordances while maximized", () => {
  assert.match(source, /rightPanelOpen && !rightPanelMaximized && \(/);
  assert.match(source, /rightPanelOpen && !rightPanelMaximized \? " is-open" : ""/);
  assert.match(source, /right-panel-container\$\{rightPanelOpen \? " right-panel-open" : " right-panel-closed"\}\$\{rightPanelMaximized \? " right-panel-maximized" : ""\}/);
});

test("keyboard activation transfers focus between maximize and restore", () => {
  assert.match(source, /pendingFilePanelLayoutFocusRef\.current = "restore"/);
  assert.match(source, /pendingFilePanelLayoutFocusRef\.current = "maximize"/);
  assert.match(source, /filePanelRestoreButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /filePanelMaximizeButtonRef\.current\?\.focus\(\)/);
});
