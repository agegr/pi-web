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
const { AvatarConfigProvider } = await jiti.import("./AvatarConfigProvider.tsx");

function renderModal(initialConfig = null) {
  const modal = React.createElement(AvatarsConfig, {
    cwd: "/work/example-project",
    onClose() {},
  });
  if (!initialConfig) return renderToStaticMarkup(modal);
  // `initialConfig` seeds context for SSR tests without running the provider's fetch effect.
  return renderToStaticMarkup(
    React.createElement(
      AvatarConfigProvider,
      { cwd: "/work/example-project", initialConfig },
      modal,
    ),
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
  // Each role renders an AvatarPreview + a RoleAvatar; both expose the
  // default source marker, so 3 roles produce 6 markers.
  assert.equal((html.match(/data-avatar-source="default"/g) ?? []).length, 6);
  assert.equal((html.match(/>Default<\/div>/g) ?? []).length, 3);
});

test("exposes a hidden file input and an Upload button for every role", () => {
  const html = renderModal();

  for (const role of ["user", "assistant", "tool"]) {
    assert.match(
      html,
      new RegExp(
        `<input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-upload-input="${role}"`,
      ),
    );
    assert.match(
      html,
      new RegExp(`data-avatar-upload-button="${role}"`),
    );
  }
});

test("exposes a disabled Save button until the user edits a role", () => {
  const html = renderModal();

  const saveButtonMatch = html.match(/<button[^>]*data-avatars-settings-save="true"[^>]*>/);
  assert.ok(saveButtonMatch, "Save button is rendered");
  assert.match(saveButtonMatch[0], /disabled=""/);
});

test("reset controls are conditional on a saved custom avatar", () => {
  const html = renderModal();
  assert.doesNotMatch(html, /data-avatar-reset-button/);
});

test("renders reset controls for saved custom avatars", () => {
  const html = renderModal({
    user: "data:image/png;base64,dXNlcg==",
    assistant: null,
    tool: null,
  });

  assert.match(html, /data-avatar-reset-button="user"/);
  assert.doesNotMatch(html, /data-avatar-reset-button="assistant"/);
  assert.doesNotMatch(html, /data-avatar-reset-button="tool"/);
  assert.match(html, /data-avatar-source="custom"/);
});
