import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("keeps access on the left and reasoning beside the model", () => {
  assert.match(source, /TOOL_PRESET_LABEL_KEYS/);
  assert.match(source, /data-thinking-badge=\{thinkingLevel/);
  assert.match(source, /<Brain /);
  assert.match(source, /<Shield /);
  assert.match(source, /composer-chip/);
  assert.match(source, /chat\.compactContext/);
  assert.doesNotMatch(source, /MoreHorizontal/);
  assert.doesNotMatch(source, /Change model/);
});

test("keeps the composer toolbar at three grid cells on mobile", () => {
  // The mobile toolbar is a 3-column grid (attach | access+model | right).
  // Access and model must share one grid cell, or the right group wraps to
  // row two and crushes the access chip to zero width.
  assert.match(source, /gridTemplateColumns: isMobile \? "auto minmax\(0, 1fr\) auto"/);
  assert.match(source, /className="composer-middle"/);
  const middle = source.indexOf('className="composer-middle"');
  assert.ok(middle >= 0);
  const moreMenu = source.indexOf("moreMenuRef", middle);
  const modelDropdown = source.indexOf("dropdownRef", middle);
  assert.ok(moreMenu > middle && moreMenu < middle + 3000, "access chip must live inside the middle cell");
  assert.ok(modelDropdown > middle && modelDropdown < middle + 6000, "model selector must live inside the middle cell");
});
