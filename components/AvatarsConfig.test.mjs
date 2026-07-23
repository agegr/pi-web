import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AvatarsConfig } = await jiti.import("./AvatarsConfig.tsx");

function renderModal() {
  return renderToStaticMarkup(
    React.createElement(AvatarsConfig, {
      cwd: "/work/example-project",
      onClose() {},
    }),
  );
}

test("renders the Avatars modal with the explicit project config path", () => {
  const html = renderModal();

  assert.match(html, /data-avatars-settings-modal="true"/);
  assert.match(html, />Avatars</);
  assert.match(html, /\/work\/example-project\/\.pi\/avatars\.json/);
  assert.match(html, /aria-label="Close avatars settings"/);
});

test("renders null-backed defaults for all three avatar roles", () => {
  const html = renderModal();

  for (const [role, letter] of [
    ["user", "U"],
    ["assistant", "A"],
    ["tool", "T"],
  ]) {
    assert.match(html, new RegExp(`data-avatar-setting-role="${role}"`));
    assert.match(html, new RegExp(`data-avatar-role="${role}"`));
    assert.match(html, new RegExp(`>${letter}</span>`));
  }
  assert.equal((html.match(/data-avatar-source="default"/g) ?? []).length, 3);
  assert.equal((html.match(/>Default<\/div>/g) ?? []).length, 3);
});

test("ticket 2 modal stays read-only", () => {
  const html = renderModal();

  assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(html, />Save</);
  assert.doesNotMatch(html, />Reset</);
});
