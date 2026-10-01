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
  assert.match(customSource, /maxHeight: full \? "100%" : "min\(760px, 100%\)"/);
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

test("widens dialogs and panels on demand without changing the defaults (#947)", () => {
  // The size ladder keeps "sm" as the historical dialog; "full" fills the content
  // region (the overlay keeps its own 20px padding there).
  assert.match(
    source,
    /EXTENSION_DIALOG_SIZE_STYLES: Record<ExtensionDialogSize, [\s\S]*?sm: \{ width: "min\(560px, 100%\)", maxHeight: "min\(760px, 100%\)" \}[\s\S]*?full: \{ width: "100%", maxHeight: "100%" \}/,
  );
  // The panel keeps its historical size in its normal branch.
  assert.match(customSource, /width: full \? "100%" : "min\(920px, 100%\)"/);
  assert.match(customSource, /maxHeight: full \? "100%" : "min\(760px, 100%\)"/);

  // Both overlays get a maximize/restore button next to the collapse chevron.
  const dialogHeader = dialogSource.slice(dialogSource.indexOf('role="dialog"'), dialogSource.indexOf("{request.method === \"confirm\""));
  const customHeader = customSource.slice(customSource.indexOf('role="dialog"'));
  for (const header of [dialogHeader, customHeader]) {
    assert.match(header, /onClick=\{toggleFull\}/);
    assert.match(header, /t\("chat\.extensionMaximize"\)/);
    assert.match(header, /t\("chat\.extensionRestoreSize"\)/);
    assert.match(header, /<ExtensionSizeIcon expanded=\{full\} \/>/);
  }

  // A request-level hint wins over the stored preference; without a hint the
  // preference rules, and only hint-less dialogs write it back.
  assert.match(dialogSource, /if \(request\.dialogSize !== undefined\) return request\.dialogSize === "full";/);
  assert.match(dialogSource, /return readStoredFullPref\(EXTENSION_DIALOG_FULL_PREF\);/);
  assert.match(dialogSource, /if \(request\.dialogSize === undefined\) writeStoredFullPref\(EXTENSION_DIALOG_FULL_PREF, next\);/);
  // The panel has no hint, so its toggle always persists.
  assert.match(customSource, /readStoredFullPref\(EXTENSION_PANEL_FULL_PREF\)/);
  assert.match(customSource, /writeStoredFullPref\(EXTENSION_PANEL_FULL_PREF, next\);/);
});
