import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
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
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody className="extension-option-markdown">\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
});

test("preserves multiline titles as a heading and bounded plain-text detail above the options", () => {
  assert.match(dialogSource, /const \[heading, \.\.\.detailLines\] = request\.title\.split\(\/\\r\?\\n\/\);/);
  assert.match(dialogSource, /const detail = detailLines\.join\("\\n"\)\.trim\(\);/);
  assert.match(dialogSource, /maxWidth: "min\(640px, 100%\)"[\s\S]*?\{heading\}/);
  assert.match(dialogSource, /role="dialog"\s+aria-label=\{heading\}\s+aria-describedby=\{detail \? detailId : undefined\}/);
  assert.match(dialogSource, /width: "min\(640px, 100%\)"/);
  assert.match(dialogSource, /maxHeight: "50%", overflowY: "auto"[\s\S]*?whiteSpace: "pre-wrap", overflowWrap: "anywhere" \}\}>\{heading\}/);
  assert.match(dialogSource, /id=\{detailId\}[\s\S]*?maxHeight: "min\(168px, 30vh\)"[\s\S]*?whiteSpace: "pre-wrap"[\s\S]*?\{detail\}/);
  assert.match(dialogSource, /\{detail && \([\s\S]*?\{detail\}[\s\S]*?\{request\.method === "select"/);
  assert.match(dialogSource, /padding: "8px 10px"[\s\S]*?<MarkdownBody className="extension-option-markdown">\{option\}<\/MarkdownBody>/);
  assert.match(css, /\.markdown-body\.extension-option-markdown \{ font-size: inherit; line-height: 1\.55; \}/);
  assert.match(css, /\.markdown-body\.extension-option-markdown > :first-child \{ margin-top: 0; \}/);
  assert.match(css, /\.markdown-body\.extension-option-markdown > :last-child \{ margin-bottom: 0; \}/);
  assert.match(css, /\.markdown-body\.extension-option-markdown li \{ margin: 0; \}/);
});

test("resets collapse state when a new extension request arrives", () => {
  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});
