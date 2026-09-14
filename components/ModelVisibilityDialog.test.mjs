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
        visibleModels: [{ provider: "anthropic", id: "claude-opus-5" }],
        onClose() {},
        onChanged() {},
      }),
    ),
  );

  assert.match(html, /Model visibility/);
  assert.match(html, /enabledModels/);
  assert.match(html, /Cancel/);
  assert.match(html, /Save/);
  assert.match(html, /disabled=""/);
});

test("model selector panel exposes the manage entry only when wired", () => {
  const source = readFileSync(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
  const entryStart = source.indexOf("{onManage && sortedOptions.length > 0 && (");
  assert.notEqual(entryStart, -1, "manage entry block is missing");
  const block = source.slice(entryStart, entryStart + 3200);
  assert.match(block, /models\.visibilityManage/);
  assert.match(block, /onManage\(\)/);
  // The entry must close the dropdown before handing control to the dialog.
  assert.match(block, /setOpen\(false\)/);
  assert.match(block, /setFilter\(""\)/);
});

test("chat window hosts the dialog and refreshes models after saves", () => {
  const source = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /onManageModels=\{\(\) => setModelVisibilityOpen\(true\)\}/);
  assert.match(source, /<ModelVisibilityDialog/);
  assert.match(source, /onChanged=\{\(\) => onModelsVisibilityChanged\?\.\(\)\}/);
});

test("visibility dialog saves exact provider refs and clears on show-all", () => {
  const source = readFileSync(new URL("./ModelVisibilityDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /computeVisibilitySave\(/);
  assert.match(source, /patterns: save\.type === "clear" \? null : save\.patterns/);
  assert.match(source, /onChanged\(\)/);
});
