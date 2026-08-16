import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.match(source, /gridTemplateColumns: isMobile \? "auto minmax\(0, 1fr\) auto"/);
  assert.match(source, /className="composer-middle"/);
  const middle = source.indexOf('className="composer-middle"');
  assert.ok(middle >= 0);
  const moreMenu = source.indexOf("moreMenuRef", middle);
  const modelDropdown = source.indexOf("dropdownRef", middle);
  assert.ok(moreMenu > middle && moreMenu < middle + 3000, "access chip must live inside the middle cell");
  assert.ok(modelDropdown > middle && modelDropdown < middle + 6000, "model selector must live inside the middle cell");
});

test("lets the mobile access chip shrink before it can overlap the streaming controls", () => {
  const middle = source.slice(
    source.indexOf('className="composer-middle"'),
    source.indexOf('{/* RIGHT: thinking + send */'),
  );
  assert.match(middle, /className="composer-access"/);
  const access = source.slice(
    source.indexOf('className="composer-access"'),
    source.indexOf("{moreMenuOpen &&", source.indexOf('className="composer-access"')),
  );
  assert.match(access, /flex: isMobile && isStreaming \? "0 1 auto" : "0 0 auto"/);
  const accessButton = access.slice(access.indexOf("aria-expanded"), access.indexOf(">", access.indexOf("aria-expanded")));
  assert.match(accessButton, /minWidth: 0/);
  assert.match(accessButton, /width: "100%"/);
  assert.match(accessButton, /maxWidth: "100%"/);
  assert.match(access, /overflow: "hidden"/);
  assert.match(access, /boxSizing: "border-box"/);
  assert.match(access, /className="composer-access-label"/);
  assert.match(access, /textOverflow: "ellipsis"/);
  assert.match(source, /className=\{`composer-shell\$\{isStreaming \? " is-streaming" : ""\}`\}/);
  assert.match(source, /className="composer-model-selector" style=\{\{ flex: isMobile \? "1 1 auto" : "0 0 auto", minWidth: 0, display: isMobile && isStreaming \? "none" : "flex"/);
  assert.match(source, /className="composer-access-chevron"/);
  assert.match(source, /className="composer-chip composer-thinking-chip"/);
  assert.match(source, /className="composer-thinking-label"/);
  assert.match(source, /className="composer-thinking-chevron"/);
  assert.match(css, /\.composer-shell\.is-streaming \.composer-access-chevron \{\s*display: none;/);
  assert.match(css, /@media \(max-width: 360px\) \{[\s\S]*?\.composer-shell\.is-streaming \.composer-thinking-label \{[\s\S]*?display: none;/);
  assert.match(css, /\.composer-shell\.is-streaming \.composer-thinking-chip \{[\s\S]*?width: 44px;[\s\S]*?flex: 0 0 44px;/);
});
