import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = relativePath => readFile(path.join(root, relativePath), "utf8");

test("SegmentedControl 提供受控接口与无障碍按钮组语义", async () => {
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

test("SegmentedControl 样式使用统一容器、分隔线与状态", async () => {
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

test("OptionSelect 提供受控接口、listbox 语义与完整键盘行为", async () => {
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
  // Escape 关闭并阻断冒泡，避免关闭父级设置 dialog。
  assert.match(content, /event\.key === "Escape"\)[\s\S]*?event\.stopPropagation\(\);[\s\S]*?close\(\);/);
  // 方向键与 Home/End 在可用选项间移动焦点。
  assert.match(content, /event\.key === "ArrowDown"/);
  assert.match(content, /event\.key === "ArrowUp"/);
  assert.match(content, /event\.key === "Home"/);
  assert.match(content, /event\.key === "End"/);
  assert.match(content, /\[role="option"\]:not\(\[disabled\]\)/);
  // 外部 pointer down 关闭，resize/scroll 重定位，卸载清理监听。
  assert.match(content, /document\.addEventListener\("pointerdown"/);
  assert.match(content, /document\.removeEventListener\("pointerdown"/);
  assert.match(content, /window\.addEventListener\("resize", updatePlacement\)/);
  assert.match(content, /window\.addEventListener\("scroll", updatePlacement, true\)/);
  assert.match(content, /window\.removeEventListener\("resize", updatePlacement\)/);
  assert.match(content, /window\.removeEventListener\("scroll", updatePlacement, true\)/);
  // 空 options、整体 disabled 或全部选项 disabled 时触发器禁用，避免 Escape 泄漏到父级 dialog。
  assert.match(content, /const hasEnabledOption = options\.some\(option => !option\.disabled\);/);
  assert.match(content, /const unusable = disabled \|\| options\.length === 0 \|\| !hasEnabledOption;/);
  assert.match(content, /selectedOption \? selectedOption\.label : value/);
  // 选择后关闭并把焦点还给触发器。
  assert.match(content, /triggerRef\.current\?\.focus\(\)/);
  // 定位从根容器矩形和视口宽度计算横向可用空间及偏移，并将结果应用到面板内联样式。
  assert.match(content, /const rect = root\.getBoundingClientRect\(\);/);
  assert.match(content, /const viewportWidth = window\.innerWidth;/);
  assert.match(content, /const offsetX = Math\.max\(safeInset - rect\.left, 0\);/);
  assert.match(content, /const availableWidth = Math\.max\(0, viewportWidth - safeInset - \(rect\.left \+ offsetX\)\);/);
  assert.match(content, /setPanelPlacement\(\{[\s\S]*?placement:[\s\S]*?maxWidth: availableWidth,[\s\S]*?offsetX,[\s\S]*?\}\);/);
  assert.match(content, /style=\{\{[\s\S]*?maxWidth: `\$\{panelPlacement\.maxWidth\}px`,[\s\S]*?transform: `translateX\(\$\{panelPlacement\.offsetX\}px\)`,/);
});

test("OptionSelect 样式提供触发器、面板定位和选中勾号", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.ui-option-select \{[^}]*position: relative;[^}]*width: 100%;/);
  assert.match(css, /\.ui-option-select-trigger \{[^}]*cursor: pointer;[^}]*border: 1px solid var\(--border\);[^}]*border-radius: 5px;/);
  assert.match(css, /\.ui-option-select-trigger:disabled \{[^}]*cursor: not-allowed;/);
  assert.match(css, /\.ui-option-select-trigger:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/);
  assert.match(css, /\.ui-option-select-panel \{[^}]*position: absolute;[^}]*max-height: 260px;[^}]*overflow-y: auto;/);
  // 横向边界由组件根据 trigger 相对视口的位置计算，CSS 不再以固定视口宽度作为唯一约束。
  assert.doesNotMatch(css, /max-width: calc\(100vw - 16px\);/);
  assert.match(css, /\.ui-option-select-panel\[data-placement="bottom"\] \{[^}]*top: calc\(100% \+ 4px\);/);
  assert.match(css, /\.ui-option-select-panel\[data-placement="top"\] \{[^}]*bottom: calc\(100% \+ 4px\);/);
  assert.match(css, /\.ui-option-select-option\[aria-selected="true"\] \{[^}]*background: var\(--bg-selected\);[^}]*font-weight: 600;/);
  assert.match(css, /\.ui-option-select-option:disabled \{[^}]*cursor: not-allowed;/);
  assert.match(css, /\.ui-option-select-check \{[^}]*visibility: hidden;/);
  assert.match(css, /\.ui-option-select-option\[aria-selected="true"\] \.ui-option-select-check \{[^}]*visibility: visible;/);
});
