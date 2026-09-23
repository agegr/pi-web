import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const settingsCssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const extensionStatusBarSource = await readFile(new URL("./ExtensionStatusBar.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100vh;/);
});

test("reserves safe-area insets only where the scenario needs them (pi#1)", () => {
  // Mobile browsers already lay out below the browser chrome, so the
  // reservations default to zero there; installed standalone PWAs draw under
  // the system bars and must keep the env() insets.
  assert.match(cssSource, /:root \{[\s\S]*?--safe-area-top: 0px;[\s\S]*?--safe-area-bottom: 0px;[\s\S]*?\}/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--safe-area-top: env\(safe-area-inset-top\);[\s\S]*?--safe-area-bottom: env\(safe-area-inset-bottom\);/);
  assert.doesNotMatch(appShellSource, /env\(safe-area-inset-top\)/);
  assert.doesNotMatch(appShellSource, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(chatWindowSource, /env\(safe-area-inset-bottom\)/);
  assert.match(appShellSource, /height: "calc\(36px \+ var\(--safe-area-top, 0px\)\)", paddingTop: "var\(--safe-area-top, 0px\)"/);
  assert.match(appShellSource, /\/\* Right panel tab bar \*\/[\s\S]*?height: "calc\(36px \+ var\(--safe-area-top, 0px\)\)",[\s\S]*?paddingTop: "var\(--safe-area-top, 0px\)"/);
  assert.match(appShellSource, /paddingBottom: "var\(--safe-area-bottom, 0px\)"/);
  assert.match(chatWindowSource, /paddingBottom: "var\(--safe-area-bottom, 0px\)"/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "var\(--safe-area-top, 0px\)"/);
  assert.match(appShellSource, /paddingBottom: "var\(--safe-area-bottom, 0px\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
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
  assert.match(chatWindowSource, /paddingBottom: "var\(--safe-area-bottom, 0px\)"/);
});

test("compacts the extension status shelf on phones and expands it in place", () => {
  assert.match(cssSource, /@media \(max-width: 640px\) \{[\s\S]*?\.extension-status-line \{[\s\S]*?max-height: 28px;[\s\S]*?overflow: hidden;/);
  assert.match(cssSource, /\.extension-status-line \.extension-status-text \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(cssSource, /\.extension-status-line\.extension-status-expanded \{[\s\S]*?max-height: min\(144px, 18dvh\);[\s\S]*?overflow: auto;/);
  assert.match(extensionStatusBarSource, /setExpanded/);
  assert.match(extensionStatusBarSource, /extension-status-expanded/);
});

test("keeps streaming controls reachable on narrow phones", () => {
  assert.match(chatInputSource, /useIsNarrowMobile\(\)/);
  assert.match(chatInputSource, /const renderStopButton = \(iconOnly: boolean\) =>/);
  assert.match(chatInputSource, /const renderSteerFollowUpButtons = \(showLabel: boolean, popupStyle: boolean\) =>/);
  // Stop never lives inside the mobile more-menu: it renders icon-only in the
  // composer row on mobile and keeps its label on desktop.
  assert.match(chatInputSource, /\{isMobile && renderStopButton\(true\)\}/);
  assert.match(chatInputSource, /\{!isMobile && isStreaming && renderStopButton\(false\)\}/);
  // Steer / follow-up stay beside the composer except on narrow phones, where
  // they collapse into the more-menu and regain their labels when it opens.
  assert.match(chatInputSource, /\{!isNarrowMobile && renderSteerFollowUpButtons\(!isMobile, false\)\}/);
  assert.match(chatInputSource, /\{isStreaming && isNarrowMobile && renderSteerFollowUpButtons\(!isMobile \|\| controlsMenuOpen, true\)\}/);
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
