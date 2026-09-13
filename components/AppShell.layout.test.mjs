import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("switching changes surface roles without reversing the fixed layout tracks", () => {
  assert.match(source, /const \[workspaceSwapped, setWorkspaceSwapped\] = useState\(false\);/);
  assert.match(source, /setWorkspaceSwapped\(\(swapped\) => !swapped\)/);
  assert.match(css, /grid-template-areas: "main separator secondary"/);
  assert.doesNotMatch(css, /grid-template-areas: "workspace separator chat"/);
  assert.match(css, /\.main-panels:not\(\.workspace-swapped\) \.chat-slot,[\s\S]*?grid-area: main/);
  assert.match(css, /\.main-panels\.workspace-swapped \.right-panel-container[\s\S]*?grid-area: main/);
  assert.match(css, /\.main-panels\.workspace-swapped \.chat-slot[\s\S]*?grid-area: secondary/);
});

test("fixed controls target roles instead of moving with chat or editor content", () => {
  assert.match(source, /className=\{mobile \? undefined : "desktop-sidebar-toggle"\}/);
  assert.match(source, /cssVariableMirrorRef: appShellRef/);
  assert.match(source, /sidebarOpen \? "var\(--sidebar-width\)" : "0px"/);
  assert.match(source, /className=\{mobile \? undefined : "desktop-secondary-workspace-toggle"\}/);
  assert.match(source, /aria-controls=\{mobile \? "file-panel" : secondaryWorkspaceId\}/);
  assert.match(source, /rightPanelOpen[\s\S]*?\? "var\(--right-panel-width\)"[\s\S]*?: "0px"/);
  assert.match(source, /className="desktop-workspace-role-toggle"/);
  assert.match(source, /\{!isMobile && rightPanelOpen && renderWorkspaceRoleToggle\(\)\}/);
  assert.match(css, /\.main-panels\.workspace-panel-open[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 0 var\(--right-panel-width/);
  assert.match(source, /background: rightPanelOpen \? "var\(--bg-panel\)" : "none"/);
  assert.match(source, /color: rightPanelOpen \? "var\(--accent\)" : "var\(--text-muted\)"/);
});

test("resizing updates live without layout-transition lag", () => {
  assert.match(source, /cssVariableMirrorRef: appShellRef/);
  assert.match(source, /className=\{`main-panels\$\{workspaceSwapped \? " workspace-swapped" : ""\}\$\{rightPanelOpen \? " workspace-panel-open" : " workspace-panel-closed"\}\$\{rightPanelResizer\.isResizing \? " main-panels-resizing" : ""\}`\}/);
  assert.match(css, /\.sidebar-container\.sidebar-resizing,[\s\S]*?transition: none !important/);
  assert.match(css, /\.main-panels\.main-panels-resizing[\s\S]*?transition: none/);
});

test("the main workspace header reserves the independent sidebar control lane", () => {
  assert.match(source, /"--main-workspace-header-leading-inset": `\$\{TOP_BAR_ICON_BUTTON_SIZE\}px`/);
  assert.match(source, /"--main-workspace-header-trailing-inset": `\$\{TOP_BAR_ICON_BUTTON_SIZE\}px`/);
  assert.equal(source.match(/className="main-workspace-header"/g)?.length, 2);
  assert.match(css, /\.main-panels > \.main-workspace \.main-workspace-header[\s\S]*?padding-inline-start: var\(--main-workspace-header-leading-inset, 36px\)/);
  assert.match(css, /\.main-panels \.main-workspace-header[\s\S]*?padding-inline-end: var\(--main-workspace-header-trailing-inset, 36px\)/);
});

test("editor-specific behavior remains active when the editor is the main region", () => {
  assert.match(source, /const editorVisible = workspaceSwapped \|\| rightPanelOpen;/);
  assert.match(source, /if \(!workspaceSwapped\) setRightPanelOpen\(true\);/);
  assert.match(source, /if \(!workspaceSwapped && !replacement && !remaining\.length && !fileTabs\.length\) setRightPanelOpen\(false\);/);
  assert.match(source, /watchEnabled=\{editorVisible\}/);
  assert.match(source, /active=\{editorVisible && tab\.id === activeFileTabId\}/);
});

test("compact and phone layouts keep role semantics", () => {
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 959px\)[\s\S]*?\.secondary-workspace/);
  assert.match(css, /\.main-panels\.workspace-swapped \.right-panel-container\.main-workspace/);
  assert.match(source, /if \(isMobile\) \{[\s\S]*?setWorkspaceSwapped\(false\);/);
});
