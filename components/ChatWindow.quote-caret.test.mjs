import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// "Quote" inserts the quote and leaves the caret at its end so the reply is
// typed after it. `window.getSelection().removeAllRanges()` clears the
// focused textarea's selection too and drops the caret to offset 0 (#1319).
test("quoting a selection into the current chat keeps the caret at the quote's end", async () => {
  for (const path of ["../components/ChatWindow.tsx", "../demo/components/ChatWindow.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const body = source.match(/const quoteSelectionHere = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/);
    assert.ok(body, `expected quoteSelectionHere in ${path}`);
    const code = body[0].replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /removeAllRanges\s*\(/,
      `${path}: inserting already collapses the page's selection, and removing ranges afterwards resets the composer's caret`,
    );
  }
});
