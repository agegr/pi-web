import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AvatarConfigProvider, useAvatarSrc } = await jiti.import(
  "./AvatarConfigProvider.tsx",
);

function makeProbe(label) {
  return function Probe() {
    const value = useAvatarSrc("user");
    return React.createElement(
      "span",
      { "data-probe": label, "data-value": value ?? "" },
      label,
    );
  };
}

test("AvatarConfigProvider exposes a seeded initialConfig to descendants", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AvatarConfigProvider,
      {
        cwd: "/test/project",
        initialConfig: {
          user: "data:image/png;base64,Zm9v",
          assistant: null,
          tool: null,
        },
      },
      React.createElement(makeProbe("user-avatar")),
    ),
  );
  assert.match(html, /data-probe="user-avatar"/);
  assert.match(html, /data-value="data:image\/png;base64,Zm9v"/);
});

test("AvatarConfigProvider normalizes non-string initial values to null", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AvatarConfigProvider,
      {
        cwd: "/test/project",
        initialConfig: {
          user: 42,
          assistant: null,
          tool: null,
        },
      },
      React.createElement(makeProbe("user-avatar")),
    ),
  );
  assert.match(html, /data-value=""/);
});

test("useAvatarSrc returns null when no provider is mounted", () => {
  const html = renderToStaticMarkup(React.createElement(makeProbe("orphan")));
  assert.match(html, /data-probe="orphan"/);
  assert.match(html, /data-value=""/);
});