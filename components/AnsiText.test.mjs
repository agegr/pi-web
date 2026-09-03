import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AnsiText } = await jiti.import("./AnsiText.tsx");

function toHtml(text) {
  return renderToStaticMarkup(React.createElement(AnsiText, { text }));
}

test("plain text without escapes passes through unchanged", () => {
  assert.equal(toHtml("hello world"), "<span>hello world</span>");
});

test("24-bit rgb foreground and background colors", () => {
  const html = toHtml(
    "\x1b[48;2;130;202;122m\x1b[38;2;21;24;29ms \x1b[39m\x1b[49m plain",
  );
  assert.match(html, /color:rgb\(21,24,29\)/);
  assert.match(html, /background-color:rgb\(130,202,122\)/);
  assert.match(html, />s <\/span> plain/);
  assert.doesNotMatch(html, /\\x1b/);
});

test("xterm 256-color palette", () => {
  const html = toHtml("\x1b[38;5;196mred\x1b[39m rest");
  assert.match(html, /color:rgb\(255,0,0\)/);
  assert.match(html, />red<\/span> rest/);
});

test("standard 16 colors and full reset", () => {
  const html = toHtml("\x1b[32mgreen\x1b[0m tail");
  assert.match(html, /color:rgb\(0,187,0\)/);
  assert.match(html, /tail/);
});

test("decoration codes render as styles (not dropped)", () => {
  const html = toHtml("\x1b[1m bold \x1b[22m tail");
  assert.match(html, /font-weight:bold/);
  assert.match(html, / tail/);
});

test("widget text cannot inject HTML (escape_html)", () => {
  const html = toHtml("<script>alert(1)</script>");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("newlines inside text are preserved", () => {
  assert.equal(toHtml("line one\nline two"), "<span>line one\nline two</span>");
});

test("styles do not leak between complete widget snapshots", () => {
  assert.match(toHtml("\x1b[31mred"), /color:rgb\(187,0,0\)/);
  assert.equal(toHtml("plain"), "<span>plain</span>");
});
