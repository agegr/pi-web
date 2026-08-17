import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("./DialogShell.tsx", import.meta.url);
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

async function source() {
  return readFile(componentPath, "utf8");
}

test("uses a native modal and restores focus", async () => {
  const value = await source();
  assert.match(value, /useRef<HTMLDialogElement>/);
  assert.match(value, /dialog\.showModal\(\)/);
  assert.match(value, /returnFocusRef\?\.current \?\? previousFocusRef\.current/);
});

test("supports separate Escape and safe backdrop dismissal", async () => {
  const value = await source();
  assert.match(value, /backdropDismissible = dismissible/);
  assert.match(value, /onCancel=\{handleCancel\}/);
  assert.match(value, /backdropDismissible && event\.target === event\.currentTarget/);
  assert.match(value, /returnFocusRef\?\.current/);
});

test("exposes shared title body footer and close chrome", async () => {
  const value = await source();
  for (const className of ["codex-dialog", "codex-dialog-header", "codex-dialog-body", "codex-dialog-footer", "codex-dialog-close"]) {
    assert.match(value, new RegExp(className));
  }
});

test("moves focus into the first field, option, or primary action", async () => {
  const value = await source();
  assert.match(value, /\.codex-dialog-input/);
  assert.match(value, /\.codex-dialog-editor/);
  assert.match(value, /\.codex-dialog-option/);
  assert.match(value, /data-variant=\\"primary\\"/);
  assert.match(value, /preferred\?\.focus\(/);
});

test("Enter activates the primary action and arrows move select options", async () => {
  const value = await source();
  assert.match(value, /event\.key !== "Enter"/);
  assert.match(value, /data-variant="primary"\]:not\(:disabled\)/);
  assert.match(value, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(value, /\.codex-dialog-option/);
});

test("defines fixed desktop and mobile dialog dimensions", () => {
  assert.match(styles, /\.codex-dialog\[data-size="confirm"\][\s\S]*?width:\s*min\(420px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.codex-dialog\[data-size="request"\][\s\S]*?width:\s*min\(520px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.codex-dialog\[data-size="editor"\][\s\S]*?width:\s*min\(680px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.codex-dialog\[data-size="tool"\][\s\S]*?width:\s*min\(820px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.codex-dialog\[data-size="terminal"\][\s\S]*?width:\s*min\(920px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.codex-dialog\[data-size="confirm"\][\s\S]*?margin:\s*auto 0 0/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.codex-dialog\[data-size="tool"\][\s\S]*?height:\s*var\(--app-viewport-height, 100dvh\)/);
  assert.match(styles, /\.codex-dialog::backdrop[\s\S]*?backdrop-filter:\s*blur\(6px\)/);
  assert.match(styles, /@keyframes\s+codex-dialog-in/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?animation:\s*none/);
  assert.match(styles, /\.codex-dialog-body[\s\S]*?font-size:\s*var\(--text-ui\)/);
  assert.match(styles, /\.codex-dialog-option\s*\{[\s\S]*?min-height:\s*40px;/);
});
