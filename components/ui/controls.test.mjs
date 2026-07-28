import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = relativePath => readFile(path.join(root, relativePath), "utf8");

test("SegmentedControl provides a controlled interface and accessible button-group semantics", async () => {
  const content = await source("components/ui/SegmentedControl.tsx");

  assert.match(content, /export interface SegmentedControlOption \{/);
  assert.match(content, /value: string;/);
  assert.match(content, /label: ReactNode;/);
  assert.match(content, /disabled\?: boolean;/);
  assert.match(content, /title\?: string;/);
  assert.match(content, /className\?: string;/);
  assert.match(content, /export interface SegmentedControlProps \{/);
  assert.match(content, /options: readonly SegmentedControlOption\[\];/);
  assert.match(content, /onChange: \(value: string, event: MouseEvent<HTMLButtonElement>\) => void;/);
  assert.match(content, /ariaLabel\?: string;/);
  assert.match(content, /export function SegmentedControl\(/);
  assert.match(content, /role="group"/);
  assert.match(content, /aria-label=\{ariaLabel\}/);
  assert.match(content, /type="button"/);
  assert.match(content, /aria-pressed=\{selected\}/);
  assert.match(content, /disabled=\{option\.disabled\}/);
  assert.match(content, /title=\{option\.title\}/);
  assert.match(content, /if \(option\.disabled \|\| selected\) return;/);
  assert.match(content, /onChange\(option\.value, event\)/);
  assert.match(content, /option\.className/);
});

test("SegmentedControl styling uses a shared container, separators, and states", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.ui-segmented-control \{[^}]*display: inline-flex;[^}]*overflow: hidden;[^}]*border: 1px solid var\(--border\);[^}]*border-radius: 5px;/);
  assert.match(css, /\.ui-segmented-control-option \{[^}]*padding: 4px 10px;[^}]*font-size: 12px;[^}]*cursor: pointer;/);
  assert.match(css, /\.ui-segmented-control-option \+ \.ui-segmented-control-option \{[^}]*border-left: 1px solid var\(--border\);/);
  assert.match(css, /\.ui-segmented-control-option:hover:not\(:disabled\) \{[^}]*background: var\(--bg-hover\);/);
  assert.match(css, /\.ui-segmented-control-option\[aria-pressed="true"\] \{[^}]*background: var\(--bg-selected\);[^}]*font-weight: 600;/);
  assert.match(css, /\.ui-segmented-control-option--danger\[aria-pressed="true"\] \{[^}]*background: #ef4444;[^}]*color: #fff;/);
  assert.match(css, /\.ui-segmented-control-option:disabled \{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/);
  assert.match(css, /\.ui-segmented-control-option:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/);
});

test("OptionSelect provides a controlled interface, listbox semantics, and complete keyboard behavior", async () => {
  const content = await source("components/ui/OptionSelect.tsx");

  assert.match(content, /export interface OptionSelectOption \{/);
  assert.match(content, /export interface OptionSelectProps \{/);
  assert.match(content, /onChange: \(value: string\) => void;/);
  assert.match(content, /ariaLabel: string;/);
  assert.match(content, /export function OptionSelect\(/);
  assert.match(content, /aria-haspopup="listbox"/);
  assert.match(content, /aria-expanded=\{isOpen\}/);
  assert.match(content, /role="listbox"/);
  assert.match(content, /role="option"/);
  assert.match(content, /aria-selected=\{selected\}/);
  // Escape closes the list and stops propagation to avoid closing the parent settings dialog.
  assert.match(content, /event\.key === "Escape"\)[\s\S]*?event\.stopPropagation\(\);[\s\S]*?close\(\);/);
  // Arrow keys and Home/End move focus among enabled options.
  assert.match(content, /event\.key === "ArrowDown"/);
  assert.match(content, /event\.key === "ArrowUp"/);
  assert.match(content, /event\.key === "Home"/);
  assert.match(content, /event\.key === "End"/);
  assert.match(content, /\[role="option"\]:not\(\[disabled\]\)/);
  // Outside pointerdown closes the list, resize/scroll repositions it, and unmount cleans up listeners.
  assert.match(content, /document\.addEventListener\("pointerdown"/);
  assert.match(content, /document\.removeEventListener\("pointerdown"/);
  assert.match(content, /window\.addEventListener\("resize", updatePlacement\)/);
  assert.match(content, /window\.addEventListener\("scroll", updatePlacement, true\)/);
  assert.match(content, /window\.removeEventListener\("resize", updatePlacement\)/);
  assert.match(content, /window\.removeEventListener\("scroll", updatePlacement, true\)/);
  // The trigger is disabled for empty options, an entirely disabled control, or all-disabled options.
  assert.match(content, /const hasEnabledOption = options\.some\(option => !option\.disabled\);/);
  assert.match(content, /const unusable = disabled \|\| options\.length === 0 \|\| !hasEnabledOption;/);
  assert.match(content, /selectedOption \? selectedOption\.label : value/);
  // Close after selection and return focus to the trigger.
  assert.match(content, /triggerRef\.current\?\.focus\(\)/);
  // Calculate horizontal space and offset from the root rectangle and viewport width, then apply them inline.
  assert.match(content, /const rect = root\.getBoundingClientRect\(\);/);
  assert.match(content, /const viewportWidth = window\.innerWidth;/);
  assert.match(content, /const offsetX = Math\.max\(safeInset - rect\.left, 0\);/);
  assert.match(content, /const availableWidth = Math\.max\(0, viewportWidth - safeInset - \(rect\.left \+ offsetX\)\);/);
  assert.match(content, /setPanelPlacement\(\{[\s\S]*?placement:[\s\S]*?maxWidth: availableWidth,[\s\S]*?offsetX,[\s\S]*?\}\);/);
  assert.match(content, /style=\{\{[\s\S]*?maxWidth: `\$\{panelPlacement\.maxWidth\}px`,[\s\S]*?transform: `translateX\(\$\{panelPlacement\.offsetX\}px\)`,/);
});

test("OptionSelect styling provides a trigger, panel placement, and selected checkmark", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.ui-option-select \{[^}]*position: relative;[^}]*width: 100%;/);
  assert.match(css, /\.ui-option-select-trigger \{[^}]*cursor: pointer;[^}]*border: 1px solid var\(--border\);[^}]*border-radius: 5px;/);
  assert.match(css, /\.ui-option-select-trigger:disabled \{[^}]*cursor: not-allowed;/);
  assert.match(css, /\.ui-option-select-trigger:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/);
  assert.match(css, /\.ui-option-select-panel \{[^}]*position: absolute;[^}]*max-height: 260px;[^}]*overflow-y: auto;/);
  // The component calculates horizontal bounds from the trigger's viewport position instead of relying on fixed CSS width.
  assert.doesNotMatch(css, /max-width: calc\(100vw - 16px\);/);
  assert.match(css, /\.ui-option-select-panel\[data-placement="bottom"\] \{[^}]*top: calc\(100% \+ 4px\);/);
  assert.match(css, /\.ui-option-select-panel\[data-placement="top"\] \{[^}]*bottom: calc\(100% \+ 4px\);/);
  assert.match(css, /\.ui-option-select-option\[aria-selected="true"\] \{[^}]*background: var\(--bg-selected\);[^}]*font-weight: 600;/);
  assert.match(css, /\.ui-option-select-option:disabled \{[^}]*cursor: not-allowed;/);
  assert.match(css, /\.ui-option-select-check \{[^}]*visibility: hidden;/);
  assert.match(css, /\.ui-option-select-option\[aria-selected="true"\] \.ui-option-select-check \{[^}]*visibility: visible;/);
});
