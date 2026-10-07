import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("confines extension overlays to the content region above the composer", () => {
  assert.doesNotMatch(source, /function ExtensionRequestSheet/);
  assert.match(
    source,
    /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"[\s\S]*?<ExtensionDialog[\s\S]*?<ExtensionCustomPanel[\s\S]*?className="relative shrink-0"[\s\S]*?{chatInputElement}/,
  );
  assert.match(dialogSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(dialogSource, /pointerEvents: "none"/);
  assert.match(dialogSource, /pointerEvents: "auto"/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(customSource, /pointerEvents: "none"/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /maxHeight: "min\(760px, 100%\)"/);
});

test("adds collapse without replacing cancel", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.doesNotMatch(dialogSource, /chat\.extensionSkip/);
});

test("renders extension confirmation and options as markdown", () => {
  assert.match(source, /import \{ MarkdownBody \} from "\.\/MarkdownBody"/);
  assert.match(dialogSource, /<MarkdownBody>\{request\.message\}<\/MarkdownBody>/);
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody>\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
});

test("preserves title newlines like pi's TUI and keeps long titles from hiding the body", () => {
  const header = dialogSource.slice(dialogSource.indexOf('role="dialog"'), dialogSource.indexOf("{request.method === \"confirm\""));
  assert.match(header, /whiteSpace: "pre-wrap", overflowWrap: "anywhere" \}\}>\{request\.title\}/);
  // The dialog's own height is content-driven (only max-height is set), so a percentage
  // cap on the header never resolves and a non-shrinkable header grows to its full text
  // height, pushing the option list and the footer past the dialog's overflow edge (#890).
  // The cap has to be viewport-based and the header has to be allowed to shrink and scroll.
  assert.match(header, /flexShrink: 1, minHeight: 0,[\s\S]*?maxHeight: "50vh", overflowY: "auto" \}\}>[\s\S]*?\{request\.title\}/);
  assert.doesNotMatch(header, /maxHeight: "50%"/);
});

test("resets collapse state when a new extension request arrives", () => {
  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});

test("shows how many extension requests wait behind the one on screen", () => {
  const expandedHeader = dialogSource.slice(dialogSource.indexOf('role="dialog"'), dialogSource.indexOf("{request.method === \"confirm\""));
  const collapsedButton = dialogSource.slice(dialogSource.indexOf("{collapsed ? ("), dialogSource.indexOf('role="dialog"'));
  const customCollapsed = customSource.slice(customSource.indexOf("{collapsed ? ("), customSource.indexOf('role="dialog"'));
  const customExpanded = customSource.slice(customSource.indexOf('role="dialog"'));
  const waitingSource = source.slice(source.indexOf("function ExtensionWaitingCount"), source.indexOf("function ExtensionDialog("));

  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\} request=\{extensionDialog\} waitingCount=\{waitingExtensionDialogCount\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\} request=\{extensionCustomUi\} waitingCount=\{waitingExtensionCustomUiCount\}/);
  assert.match(waitingSource, /if \(count <= 0\) return null;[\s\S]*?t\("chat\.extensionMoreWaiting", \{ count \}\)/);
  assert.match(expandedHeader, /chat\.extensionRequest"\)\}<\/span>\s+<ExtensionWaitingCount count=\{waitingCount\} \/>\s+\{countdown\}/);
  assert.match(collapsedButton, /<ExtensionWaitingCount count=\{waitingCount\} \/>\s+\{countdown\}/);
  assert.match(customCollapsed, /<ExtensionWaitingCount count=\{waitingCount\} \/>\s+<span[^>]*>\s+\{t\("chat\.extensionExpand"\)\}/);
  assert.match(customExpanded, /chat\.extensionPanel"\)\}<\/div>\s+<div[^>]*>\s+<ExtensionWaitingCount count=\{waitingCount\} \/>/);
});

test("fits dialogs to their code blocks and lets the user maximize them (#947)", () => {
  const dialogOnly = dialogSource.slice(0, dialogSource.indexOf("function ExtensionCustomPanel"));
  // Plain pi compatibility: nothing about size travels in the request or comes from an extension.
  assert.doesNotMatch(source, /dialogSize/);

  // A dialog opens at the historical 560px and only grows through the measured fit.
  assert.match(
    dialogOnly,
    /width: full \? "100%" : `min\(\$\{fitWidth \?\? EXTENSION_DIALOG_BASE_WIDTH\}px, 100%\)`,\s+maxHeight: full \? "100%" : "min\(760px, 100%\)"/,
  );
  // Only blocks that scroll sideways count, and the fit never shrinks again while it is read.
  assert.match(dialogOnly, /querySelectorAll<HTMLElement>\("pre, \.markdown-table-wrap"\)/);
  assert.match(dialogOnly, /block\.scrollWidth - block\.clientWidth/);
  assert.match(dialogOnly, /prev !== null && prev >= needed \? prev : needed/);
  // Highlighted code swaps in after the first paint, so the fit watches the body.
  assert.match(dialogOnly, /new MutationObserver\(fit\)[\s\S]*?observe\(body, \{ childList: true, subtree: true, characterData: true \}\)/);

  // The maximize/restore button sits next to the collapse chevron and only affects this dialog.
  const header = dialogOnly.slice(dialogOnly.indexOf('role="dialog"'), dialogOnly.indexOf("{request.method === \"confirm\""));
  assert.match(header, /onClick=\{toggleFull\}[\s\S]*?t\("chat\.extensionMaximize"\)[\s\S]*?t\("chat\.extensionRestoreSize"\)[\s\S]*?<ExtensionSizeIcon expanded=\{full\} \/>[\s\S]*?onClick=\{\(\) => setCollapsed\(true\)\}/);
  assert.doesNotMatch(source, /localStorage|pi-extension-/);
});

test("shows a custom panel's lines whole instead of scrolling when they are wider than 920px (#947)", () => {
  // The extension wraps its lines to the width it asked for, so the panel only has to be
  // as wide as the widest of them, capped to the content region.
  assert.match(customSource, /width: "max-content",\s+minWidth: "min\(920px, 100%\)",\s+maxWidth: "100%"/);
  assert.doesNotMatch(customSource.slice(0, customSource.indexOf("\n}\n")), /toggleFull|extensionMaximize/);
});
