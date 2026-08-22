import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const minimapCss = () => readFile(new URL("./ChatMinimap.module.css", import.meta.url), "utf8");

function ruleBody(css, selector) {
  // Anchor at a line start so `.user` never matches `.turn[...] .user`.
  const start = css.indexOf("\n" + selector + " {");
  assert.ok(start >= 0, `missing rule: ${selector}`);
  return css.slice(start + 1, css.indexOf("}", start));
}

test("minimap request rows reuse the chat's user bubble blue", async () => {
  const css = await minimapCss();
  const user = ruleBody(css, ".user");

  // Same token MessageView paints the user bubble with, so the outline and the
  // transcript cannot drift apart.
  assert.match(user, /background: var\(--user-bg\)/);
  assert.doesNotMatch(user, /background: transparent/);
});

test("minimap request rows stay distinguishable when hovered, focused and located", async () => {
  const css = await minimapCss();

  for (const selector of ['.user:hover', '.user:focus-visible', '.turn[data-located="true"] .user']) {
    assert.match(ruleBody(css, selector), /var\(--user-bg\)/, `${selector} must stay blue`);
  }

  // Answer rows keep the neutral treatment: the contrast is the whole point.
  const heading = ruleBody(css, ".heading:focus-visible,\n.paragraph:focus-visible");
  assert.doesNotMatch(heading, /--user-bg/);
});

test("minimap request rows read as body text clamped to two lines", async () => {
  const css = await minimapCss();
  const user = ruleBody(css, ".user");
  const userText = ruleBody(css, ".userText");

  // Bold made every request shout; the blue background already separates them.
  assert.match(user, /font-weight: 400/);
  assert.match(userText, /-webkit-line-clamp: 2/);
  assert.match(userText, /line-clamp: 2/);
  // Two 18px lines plus 7px padding top and bottom.
  assert.match(user, /max-height: 50px/);
});

test("the located marker survives the opaque request background", async () => {
  const css = await minimapCss();
  const located = ruleBody(css, '.turn[data-located="true"] .user');

  assert.match(located, /inset 2px 0 0/);
});
