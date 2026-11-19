import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the selection toolbar above the session sidebar", async () => {
  const popoverSource = await readFile(new URL("./QuoteSelectionPopover.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

  const toolbar = popoverSource.match(/role=\{quoteInputOpen \? "dialog" : "toolbar"\}[\s\S]*?zIndex:\s*(\d+)/);
  const sidebar = shellSource.match(/id="session-sidebar"[\s\S]*?zIndex:\s*(\d+)/);

  assert.ok(toolbar, "expected quote toolbar z-index");
  assert.ok(sidebar, "expected session sidebar z-index");
  assert.ok(
    Number(toolbar[1]) > Number(sidebar[1]),
    `quote toolbar z-index ${toolbar[1]} should be above session sidebar z-index ${sidebar[1]}`,
  );
});
