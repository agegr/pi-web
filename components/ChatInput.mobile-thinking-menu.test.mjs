import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("anchors the mobile reasoning menu to its left edge", () => {
  assert.match(
    source,
    /thinkingDropdownOpen[\s\S]*?bottom: "calc\(100% \+ 6px\)"[\s\S]*?isMobile \? \{ left: 0 \} : \{ right: 0 \}/,
  );
});
