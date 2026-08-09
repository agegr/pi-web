import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{/* File content");
  const end = source.indexOf("</div>\n      </div>\n    </div>", start);
  assert.notEqual(start, -1, "file content comment not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

test("every open file tab keeps its FileViewer mounted", () => {
  assert.match(fileContentBlock(), /fileTabs\.map\(\(tab\) => \(/);
});

test("inactive tabs are hidden with display:none instead of being unmounted", () => {
  assert.match(
    fileContentBlock(),
    /display:\s*tab\.id === activeFileTabId \? "block" : "none"/,
  );
});

test("the empty state only renders when no file tabs are open", () => {
  assert.match(fileContentBlock(), /fileTabs\.length === 0 \? \(/);
});

test("each mounted viewer is keyed by tab id and receives per-tab props", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{tab\.id\}/);
  assert.match(block, /filePath=\{tab\.filePath\}/);
  assert.match(block, /sourceSessionId=\{tab\.sourceSessionId\}/);
  assert.match(block, /initialDisplayMode=\{tab\.initialDisplayMode\}/);
});
