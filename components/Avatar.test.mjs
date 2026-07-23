import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { Avatar } = await jiti.import("./Avatar.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(Avatar, props));
}

test("renders a blue U by default for the user role", () => {
  const html = render({ role: "user" });
  assert.match(html, /data-avatar-role="user"/);
  assert.match(html, />U</);
  // blue background and white foreground
  assert.match(html, /background:#3b82f6/);
  assert.match(html, /color:#ffffff/);
  // default size for non-tool roles is 28
  assert.match(html, /width:28/);
  assert.match(html, /height:28/);
});

test("renders a purple A by default for the assistant role", () => {
  const html = render({ role: "assistant" });
  assert.match(html, /data-avatar-role="assistant"/);
  assert.match(html, />A</);
  assert.match(html, /background:#a855f7/);
  assert.match(html, /width:28/);
});

test("renders a smaller gray T by default for the tool role", () => {
  const html = render({ role: "tool" });
  assert.match(html, /data-avatar-role="tool"/);
  assert.match(html, />T</);
  assert.match(html, /background:#9ca3af/);
  // tool default is smaller than message avatars
  assert.match(html, /width:16/);
  assert.match(html, /height:16/);
});

test("respects an explicit size override", () => {
  const html = render({ role: "tool", size: 22 });
  assert.match(html, /width:22/);
  assert.match(html, /height:22/);
});

test("uses a circular shape (border-radius 50%)", () => {
  const html = render({ role: "assistant" });
  assert.match(html, /border-radius:50%/);
});

test("sets an accessible role and label derived from the role key", () => {
  const html = render({ role: "user" });
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="user avatar"/);
  assert.match(html, /title="user avatar"/);
});

test("allows overriding the accessibility label", () => {
  const html = render({ role: "assistant", title: "Claude" });
  assert.match(html, /aria-label="Claude"/);
  assert.match(html, /title="Claude"/);
});
