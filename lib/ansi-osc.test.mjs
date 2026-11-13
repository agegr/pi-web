import assert from "node:assert/strict";
import test from "node:test";
import { stripAnsi, normalizeCustomPanelLines } from "./ansi.ts";

test("OSC hyperlinks keep their visible label with BEL and ST terminators", () => {
  for (const end of ["\x07", "\x1b\\"]) {
    const link = `\x1b]8;;https://example.com${end}label\x1b]8;;${end}`;
    assert.equal(stripAnsi(`before ${link} after`), "before label after");
    assert.deepEqual(normalizeCustomPanelLines([`│ ${link} │`]).map(stripAnsi), ["label"]);
  }
});

test("OSC title controls do not consume text between consecutive controls", () => {
  assert.equal(stripAnsi("\x1b]0;title\x1b\\first\x1b]0;next\x1b\\second"), "firstsecond");
});
