import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SidebarToast } = await jiti.import("./SidebarToast.tsx");
const source = await readFile(new URL("./SidebarToast.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/sidebar-menu.css", import.meta.url), "utf8");

const h = React.createElement;

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
}

function render(toast) {
  return decode(renderToStaticMarkup(h(SidebarToast, { toast, onDismiss() {}, dismissLabel: "Dismiss" })));
}

test("an empty toast keeps its live region on the page", () => {
  assert.equal(render(null), '<div class="sidebar-toast-region" role="status" aria-live="polite"></div>');
});

test("a toast shows its message, its actions and a labelled dismiss button", () => {
  const html = render({
    id: 3,
    message: "Archived “Fix the flaky test”",
    actions: [
      { id: "undo", label: "Undo", onClick() {} },
      { id: "view", label: "View", onClick() {} },
    ],
  });
  assert.match(html, /^<div class="sidebar-toast-region" role="status" aria-live="polite"><div class="sidebar-toast">/);
  assert.match(html, /<span class="sidebar-toast-message" title="Archived “Fix the flaky test”">Archived “Fix the flaky test”<\/span>/);
  assert.match(html, /<button type="button" class="sidebar-toast-action">Undo<\/button><button type="button" class="sidebar-toast-action">View<\/button>/);
  assert.match(html, /<button type="button" class="sidebar-toast-dismiss" aria-label="Dismiss" title="Dismiss"><svg[^>]*aria-hidden="true"/);
});

test("a toast without actions shows only its message and the dismiss button", () => {
  const html = render({ id: 4, message: "Couldn’t save: locked", actions: [] });
  assert.doesNotMatch(html, /sidebar-toast-action/);
  assert.match(html, /Couldn’t save: locked/);
});

test("a tail stays in view after the message, which alone is cut", () => {
  const html = render({ id: 5, message: "Forked “PR#1030 状态栏命令按钮", tail: " · 3f9a”", actions: [] });
  assert.match(html, /<span class="sidebar-toast-message has-tail" title="Forked “PR#1030 状态栏命令按钮 · 3f9a”"><span class="sidebar-toast-message-head">Forked “PR#1030 状态栏命令按钮<\/span><span class="sidebar-toast-message-tail"> · 3f9a”<\/span><\/span>/);
  assert.match(cssRule(".sidebar-toast-message.has-tail"), /^\s*display: flex;\s*$/);
  assert.match(cssRule(".sidebar-toast-message-head"), /min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis;/);
  assert.match(cssRule(".sidebar-toast-message-tail"), /flex: none;\s*white-space: pre;/, "never shrinks; keeps its leading space");
  // Without one, the message is the plain one-line span.
  assert.doesNotMatch(render({ id: 6, message: "Forked “x”", actions: [] }), /has-tail|sidebar-toast-message-(head|tail)/);
});

test("each toast id is its own element, so its timer and entrance run once", () => {
  assert.match(source, /<SidebarToastCard\s+key=\{toast\.id\}/);
  assert.match(source, /durationMs = DEFAULT_TOAST_DURATION_MS/);
  assert.match(source, /const DEFAULT_TOAST_DURATION_MS = 10_000;/);
  // The timer pauses while hovered (by a mouse) or focused, and reads onDismiss from a ref,
  // so a parent re-render with a new callback does not restart it.
  assert.match(source, /const paused = hovered \|\| focused;/);
  assert.match(source, /if \(paused\) return;\s*const timer = window\.setTimeout\(\(\) => onDismissRef\.current\(\), durationMs\);\s*return \(\) => window\.clearTimeout\(timer\);/);
  assert.match(source, /if \(event\.pointerType === "mouse"\) setHovered\(true\);/);
  assert.match(source, /if \(!event\.currentTarget\.contains\(event\.relatedTarget as Node \| null\)\) setFocused\(false\);/);
  // An action dismisses the toast first, so a toast it shows itself survives.
  assert.match(source, /onDismissRef\.current\(\);\s*action\.onClick\(\);/);
  assert.doesNotMatch(source, /createPortal/, "the toast renders in place inside the sidebar");
});

test("toast styles: in place at the bottom of the sidebar, entrance off under reduced motion", () => {
  assert.match(cssRule(".sidebar-toast-region"), /position: absolute;\s*right: 8px;\s*bottom: 8px;\s*left: 8px;\s*z-index: 30;\s*pointer-events: none;/);
  assert.match(cssRule(".sidebar-toast"), /pointer-events: auto;[\s\S]*animation: sidebar-toast-in 0\.16s ease-out;/);
  assert.match(cssRule(".sidebar-toast-message"), /text-overflow: ellipsis;\s*white-space: nowrap;/);
  assert.match(cssRule(".sidebar-toast-action"), /color: var\(--accent\);[\s\S]*font-weight: 600;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.sidebar-toast \{\s*animation: none;/);
});
