import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./custom-ui-terminal.ts");
}

test("headless custom UI exposes stable terminal dimensions", async () => {
  const { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS, DEFAULT_CUSTOM_UI_ROWS } = await loadSubject();
  const tui = createHeadlessCustomUiTui(() => {});

  assert.deepEqual(tui.terminal, {
    columns: DEFAULT_CUSTOM_UI_COLUMNS,
    rows: DEFAULT_CUSTOM_UI_ROWS,
    kittyProtocolActive: false,
  });
  assert.equal(Object.isFrozen(tui), true);
  assert.equal(Object.isFrozen(tui.terminal), true);
});

test("headless custom UI supports plugin rendering and render requests", async () => {
  const { createHeadlessCustomUiTui } = await loadSubject();
  let renders = 0;
  const tui = createHeadlessCustomUiTui(() => { renders += 1; }, 80, 24);
  const pluginComponent = {
    render: (width) => [`${width}:${tui.terminal.columns}x${tui.terminal.rows}`],
  };

  assert.deepEqual(pluginComponent.render(80), ["80:80x24"]);
  tui.requestRender();
  assert.equal(renders, 1);
});
