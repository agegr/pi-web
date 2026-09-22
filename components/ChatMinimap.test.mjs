import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AssistantOutline } = await jiti.import("./ChatMinimap.tsx");

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("preview popup is click-to-toggle: no hover triggers, rail click toggles, jumps close it", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
  // No hover path opens or closes the popup anymore.
  assert.doesNotMatch(source, /onMouseEnter=\{showPreview\}/);
  assert.doesNotMatch(source, /onMouseLeave=\{schedulePreviewHide\}/);
  assert.doesNotMatch(source, /PREVIEW_HIDE_DELAY/);
  // Rail click with the preview open closes it (单击弹回) instead of jumping.
  assert.match(
    source,
    /if \(minimapHovered\) \{\s*hidePreview\(\);\s*return;\s*\}/,
  );
  // A pointerdown outside preview and rail closes it too.
  assert.match(source, /window\.addEventListener\("pointerdown", onPointerDown\)/);
  // Every jump from inside the preview closes it afterwards.
  const jumpHandlers = source.match(/scrollToNode\(node, "smooth"\);[\s\S]{0,80}?setMinimapHovered\(false\);/g) ?? [];
  assert.ok(jumpHandlers.length >= 1, "user-row jump must close the preview");
  assert.match(source, /scrollToAssistant\(node, assistantIndex\);[\s\S]{0,60}?setMinimapHovered\(false\);/);
  assert.match(source, /if \(liveNode\) scrollToHeading[\s\S]{0,80}?setMinimapHovered\(false\);/);
  assert.match(source, /if \(liveNode\) scrollToAssistant\(liveNode, assistantIndex\);[\s\S]{0,60}?setMinimapHovered\(false\);/);
});

test("minimap rail width is 24px and shared across ChatWindow and ChatInput", async () => {
  const { readFile } = await import("node:fs/promises");
  const minimap = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  // The rail width is pinned at 24px and exported so all consumers share one constant.
  assert.match(minimap, /export const MINIMAP_WIDTH = 24;/);
  // ChatWindow must import the shared constant instead of defining its own.
  assert.match(chatWindow, /import \{ ChatMinimap, MINIMAP_WIDTH, useMessageRefs \} from "\.\/ChatMinimap";/);
  assert.doesNotMatch(chatWindow, /CHAT_MINIMAP_WIDTH/);
  assert.match(chatWindow, /right: isMobile \? 0 : MINIMAP_WIDTH/);
  // Composer right padding tracks the rail: 16px base + 24px rail = 40px.
  assert.match(chatInput, /paddingRight: compact \? 0 : isMobile \? 16 : 40, \/\/ desktop: 16px base \+ 24px for ChatMinimap alignment/);
});
