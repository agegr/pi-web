import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCNSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const zhTWSource = await readFile(new URL("../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");

test("Full History renders in the right panel instead of a contextless new tab", () => {
  const handler = source.slice(
    source.indexOf("const handleViewFullHistory"),
    source.indexOf("const handle", source.indexOf("const handleViewFullHistory") + 10),
  );
  // The primary path opens the in-panel export, never window.open.
  assert.match(handler, /setHistoryExportSessionId/);
  assert.match(handler, /setRightPanelOpen\(true\)/);
  assert.doesNotMatch(handler, /window\.open/);
  // The new tab remains an explicit secondary affordance, never the default.
  assert.match(source, /href=\{`\/api\/sessions\/\$\{encodeURIComponent\(historyExportSessionId\)\}\/export\?inline=1`\}/);
  assert.match(source, /target="_blank"/);
  // The snapshot itself renders in an iframe inside the panel.
  assert.match(source, /<iframe[\s\S]*?src=\{`\/api\/sessions\/\$\{encodeURIComponent\(historyExportSessionId\)\}\/export\?inline=1`\}/);
});

test("the export view always has an exit: toggled off, closed with the panel, or replaced by a file tab", () => {
  // Clicking Full History while the export is showing dismisses it.
  assert.match(source, /current === selectedSession\.id && rightPanelOpen \? null : selectedSession\.id/);
  // Closing the right panel clears the export view.
  assert.match(source, /if \(!rightPanelOpen\) setHistoryExportSessionId\(null\)/);
  // Switching to a file tab takes the panel back.
  assert.match(source, /if \(activeFileTabId !== null\) setHistoryExportSessionId\(null\)/);
});

test("the snapshot banner explains what it is and offers the standalone page", () => {
  assert.match(source, /translate\("history\.snapshot"\)/);
  assert.match(source, /translate\("history\.openInTab"\)/);
});

test("all three locales carry the new history keys", () => {
  for (const [name, localeSource] of [["en", enSource], ["zh-CN", zhCNSource], ["zh-TW", zhTWSource]]) {
    for (const key of ["history.snapshot", "history.openInTab"]) {
      assert.ok(localeSource.includes(`"${key}"`), `${name} is missing ${key}`);
    }
  }
});
