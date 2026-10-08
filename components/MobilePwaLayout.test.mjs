import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const settingsCssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");
const extensionStatusBarSource = await readFile(new URL("./ExtensionStatusBar.tsx", import.meta.url), "utf8");
const mcpConfigSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const mcpSignInSource = await readFile(new URL("./McpSignIn.tsx", import.meta.url), "utf8");
const mcpAddSource = await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8");
const newSessionBarSource = await readFile(new URL("./NewSessionContextBar.tsx", import.meta.url), "utf8");

/** The declarations of the first `selector {` rule in a stylesheet. */
function cssRule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} has a rule`);
  return css.slice(start, css.indexOf("}", start));
}

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100vh;/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(appShellSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
  assert.match(appShellSource, /height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /\/\* Right panel tab bar \*\/[\s\S]*?height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(appShellSource, /height: "var\(--app-viewport-height, 100dvh\)"/);
  assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", scheduleUpdate\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  assert.match(cssSource, /\.markdown-code-block \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(chatWindowSource, /maxHeight: "min\(760px, 100%\)"/);
  assert.match(chatInputSource, /flex: compact \? "none" : 1,\s*minWidth: 0,\s*width: "100%",/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{/);
  assert.match(settingsCssSource, /padding-top: max\(59px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(8px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /@media \(display-mode: standalone\) and \(orientation: landscape\) \{[\s\S]*?padding-top: max\(8px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(59px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(59px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /\.settings-dialog-surface,[\s\S]*?\.config-panel-root\.is-modal > \.config-panel-surface \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});

test("collapses secondary composer chrome while the mobile keyboard is open", () => {
  assert.match(viewportHookSource, /root\.dataset\.keyboardOpen = "true"/);
  assert.match(viewportHookSource, /delete root\.dataset\.keyboardOpen/);
  // Every selector the keyboard rules target must exist on the element it
  // means; a renamed class would otherwise leave the rule silently dead.
  assert.match(chatInputSource, /className="chat-input-controls"/);
  assert.match(chatInputSource, /className=\{compact \? undefined : "chat-input-shell"\}/);
  assert.match(extensionStatusBarSource, /className=\{`extension-status-shelf/);
  assert.match(chatWindowSource, /className="chat-content /);
  // Phone landscape exceeds the 640px breakpoint but has the least height.
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{\s*html\[data-keyboard-open\] \.chat-input-controls,\s*html\[data-keyboard-open\] \.extension-status-shelf \{\s*display: none !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-content \{\s*padding-bottom: 0 !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-input-shell \{\s*padding-bottom: 6px !important;/);
  // A fresh composer's project bar goes too, in a rule of its own inside the same query.
  assert.match(newSessionBarSource, /<div className="new-session-context">/);
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{[^@]*?html\[data-keyboard-open\] \.new-session-context \{\s*display: none !important;/);
  // Mobile send is icon-only but keeps an accessible name.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.send"\)\}/);
  assert.match(chatInputSource, /\{!isMobile && t\("chat\.send"\)\}/);
});

test("keeps Settings › MCP usable in the 190px phone sidebar", () => {
  // Phones stack the sidebar above the detail pane and give it 190px.
  assert.match(settingsCssSource, /@media \(max-width: 640px\) \{[\s\S]*?\.config-sidebar \{[\s\S]*?height: 190px;/);
  // Code mode is the first row, so it stays in view however many servers follow.
  const list = mcpConfigSource.slice(mcpConfigSource.indexOf("<ConfigSidebarList>"));
  assert.ok(list.indexOf("<McpCodemodeRow") < list.indexOf("<McpServerGroupList"));
  // A row keeps the shared 30px height: its badge never wraps and gives way to the name.
  const badge = cssRule(settingsCssSource, ".mcp-sidebar-badge");
  for (const declaration of ["flex-shrink: 0;", "max-width: 45%;", "overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]) {
    assert.ok(badge.includes(declaration), declaration);
  }
  // An empty group says so in small type rather than a full message block.
  assert.match(cssRule(settingsCssSource, ".mcp-sidebar-group-empty"), /font-size: 11px;/);
  // Long commands, URLs and names wrap inside the narrow detail pane instead of widening it.
  assert.match(cssRule(settingsCssSource, ".mcp-config-chip"), /max-width: 100%;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/);
  assert.match(cssRule(settingsCssSource, ".mcp-config-chips"), /flex-wrap: wrap;/);
  assert.match(cssRule(settingsCssSource, ".mcp-config-line"), /overflow-wrap: anywhere;/);
  // Sign in and Sign out wrap below each other, and the paste box gives way to its button.
  assert.match(cssRule(settingsCssSource, ".mcp-sign-in-actions"), /flex-wrap: wrap;/);
  assert.match(cssRule(settingsCssSource, ".oauth-paste-input"), /min-width: 0;/);
  // The add pane's inputs and notes take the pane's width, and its paste box grows only downwards.
  assert.match(cssRule(settingsCssSource, ".mcp-add-input"), /width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(cssRule(settingsCssSource, ".mcp-add-note"), /overflow-wrap: anywhere;/);
  assert.match(cssRule(settingsCssSource, ".config-add-source-input.is-multiline"), /resize: vertical;[\s\S]*?overflow: auto;/);
  // Every .mcp-* rule targets a class the panel (its Sign-in row, its add pane) renders, and every
  // class it renders has a rule, so a rename cannot leave a phone rule silently dead.
  const styled = new Set([...settingsCssSource.matchAll(/\.(mcp-[a-z-]+)/g)].map((match) => match[1]));
  const rendered = new Set([...`${mcpConfigSource}\n${mcpSignInSource}\n${mcpAddSource}`.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((match) => (match[1] ?? match[2]).split(/\s+/))
    .filter((name) => name.startsWith("mcp-")));
  assert.deepEqual([...styled].sort(), [...rendered].sort());
});
