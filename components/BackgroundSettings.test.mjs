import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentSource = await readFile(new URL("./BackgroundSettings.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useBackgroundAppearance.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("offers persistent background selection and an opacity slider", () => {
  assert.match(panelSource, /<BackgroundSettings \/>/);
  assert.match(componentSource, /type="file" accept="image\/\*"/);
  assert.match(componentSource, /id="settings-background-opacity"[\s\S]*?type="range"[\s\S]*?max=\{100\}/);
  assert.match(hookSource, /const DATABASE_NAME = "pi-web-backgrounds"/);
  assert.match(hookSource, /export const BACKGROUND_HISTORY_LIMIT = 20/);
  assert.match(hookSource, /records\.slice\(BACKGROUND_HISTORY_LIMIT\)/);
});

test("loads the saved background at app startup and paints it behind chat content", () => {
  assert.match(shellSource, /useBackgroundAppearance\(\);/);
  assert.match(hookSource, /--app-background-image/);
  assert.match(hookSource, /--app-background-opacity/);
  assert.match(shellSource, /className="app-main-column"/);
  assert.match(cssSource, /html\[data-app-background="true"\] \.app-main-column::before/);
  assert.match(cssSource, /pointer-events: none/);
});

test("supports selecting, disabling, and deleting recent backgrounds", () => {
  assert.match(componentSource, /history\.map/);
  assert.match(componentSource, /selectBackground\(item\.id\)/);
  assert.match(componentSource, /selectBackground\(null\)/);
  assert.match(componentSource, /removeBackground\(id\)/);
  assert.match(componentSource, /handleRemove\(item\.id\)/);
});
