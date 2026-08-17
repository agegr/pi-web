import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /apple-mobile-web-app-status-bar-style/);
  assert.match(layoutSource, /black-translucent/);
  assert.match(layoutSource, /viewport-fit=cover/);
  assert.match(layoutSource, /interactive-widget=resizes-content/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(appShellSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
  assert.match(appShellSource, /height: `calc\([^`]*px \+ env\(safe-area-inset-top\)\)`/);
  assert.match(appShellSource, /\/\* Right panel tab bar \*\/[\s\S]*?height: `calc\([^`]*px \+ env\(safe-area-inset-top\)\)`/);
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
  assert.match(chatInputSource, /flex: 1,\s*minWidth: 0,\s*width: "100%",/);
});

test("keeps the composer symmetric now that the minimap sits outside the column", () => {
  assert.doesNotMatch(chatInputSource, /minimapOffset/);
  assert.match(chatInputSource, /padding: "0 16px 8px"/);
  assert.doesNotMatch(chatWindowSource, /minimapOffset/);
  assert.match(chatWindowSource, /<ChatMinimap[\s\S]*desktop-workspace-context/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});

test("uses a restrained DSCode desktop composer without changing mobile sizing", () => {
  assert.match(chatInputSource, /className=\{`composer-shell\$\{/);
  assert.match(chatInputSource, /borderRadius: isMobile \? 20 : 12/);
  assert.match(chatInputSource, /boxShadow: isMobile[\s\S]*?0 2px 12px rgba\(0,0,0,0\.06\)[\s\S]*?: "0 2px 8px rgba\(0,0,0,0\.05\)"/);
  assert.match(chatInputSource, /maxWidth: isMobile \? undefined : 780/);
  assert.match(chatInputSource, /width: 28, height: 28/);
});

test("keeps the streaming composer in the idle capsule", () => {
  assert.doesNotMatch(chatInputSource, /isStreaming && \(onSteer \|\| onFollowUp\)\s*\n?\s*\? "rgba\(234,179,8,0\.4\)"/);
  // The steer/follow-up toggle is gone — busy delivery is gesture-driven:
  // Enter queues, click/Cmd+Enter interjects.
  assert.doesNotMatch(chatInputSource, /const \[queueMode, setQueueMode\]/);
  assert.doesNotMatch(chatInputSource, /composer-queue-toggle/);
  assert.match(chatInputSource, /isStreaming \?[\s\S]*onAbort[\s\S]*<Square/);
  assert.doesNotMatch(chatInputSource, /background: "rgba\(239,68,68,0\.08\)"/);
  assert.match(chatInputSource, /sendQueued\(accelerated\)/);
  assert.match(chatInputSource, /onSteerAllQueued\?\.\(\)/);
});

test("keeps composer send/attach at 28px with a mobile hit slop", () => {
  assert.match(chatInputSource, /className="composer-icon-hit"/);
  assert.match(chatInputSource, /width: 28, height: 28/);
  assert.match(cssSource, /\.composer-icon-hit::after \{[\s\S]*?inset: -8px/);
});

test("hides the extension status shelf while the mobile keyboard is open", () => {
  assert.match(viewportHookSource, /classList\.add\("keyboard-open"\)/);
  assert.match(viewportHookSource, /classList\.remove\("keyboard-open"\)/);
  assert.match(cssSource, /html\.keyboard-open \.extension-status-shelf \{[\s\S]*?display:\s*none/);
  assert.match(cssSource, /\.extension-widget-triggers \{[\s\S]*?overflow-x:\s*auto/);
  assert.match(cssSource, /\.extension-widget-triggers::-webkit-scrollbar-corner \{[\s\S]*?display:\s*none/);
});
