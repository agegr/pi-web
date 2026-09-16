import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ModelVisibilityDialog } = await jiti.import("./ModelVisibilityDialog.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("visibility dialog renders its shell with a disabled save while models load", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelVisibilityDialog, {
        cwd: "/tmp/project",
        onClose() {},
      }),
    ),
  );

  assert.match(html, /Model visibility/);
  assert.match(html, /enabledModels/);
  assert.match(html, /Cancel/);
  assert.match(html, /Save/);
  assert.match(html, /disabled=""/);
});

test("the dialog seeds its selection from the server-resolved scope, not the chat selector", () => {
  const source = readFileSync(new URL("./ModelVisibilityDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /const visible = data\.visible \?\? \[\];/);
  assert.match(source, /setCheckedKeys\(new Set\(visible\.map\(modelRefKey\)\)\)/);
  assert.doesNotMatch(source, /visibleModels:\s*readonly VisibleModelRef\[\];/);
});

test("Settings → Models hosts the visibility dialog; the chat selector does not", () => {
  const modelsConfig = readFileSync(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(modelsConfig, /setVisibilityOpen\(true\)/);
  assert.match(modelsConfig, /models\.visibilityManage/);
  assert.match(modelsConfig, /<ModelVisibilityDialog/);

  const selector = readFileSync(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(selector, /visibilityManage|onManage/);
  const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chatWindow, /ModelVisibilityDialog/);
});

test("visibility dialog saves exact provider refs and clears on show-all", () => {
  const source = readFileSync(new URL("./ModelVisibilityDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /computeVisibilitySave\(/);
  assert.match(source, /patterns: save\.type === "clear" \? null : save\.patterns/);
});
