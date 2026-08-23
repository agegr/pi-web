import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampPanelWidth,
  getDefaultRightPanelWidth,
  getExplorerMaxHeight,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  EXPLORER_MIN_HEIGHT,
  SESSION_LIST_MIN_HEIGHT,
} = await jiti.import("./panel-layout.ts");

test("clamps panel widths to finite bounds", () => {
  assert.equal(clampPanelWidth(420.4, 180, 480), 420);
  assert.equal(clampPanelWidth(120, 180, 480), 180);
  assert.equal(clampPanelWidth(600, 180, 480), 480);
  assert.equal(clampPanelWidth(Number.NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(200, 300, 250), 300);
});

test("the Explorer leaves the session list its minimum height", () => {
  // Tall sidebar: the Explorer may take everything above the reserved list.
  assert.equal(getExplorerMaxHeight(800), 800 - SESSION_LIST_MIN_HEIGHT);
  // Short sidebar: never collapse below the Explorer's own minimum, even if
  // that means overrunning the reserved list space.
  assert.equal(getExplorerMaxHeight(100), EXPLORER_MIN_HEIGHT);
  assert.equal(getExplorerMaxHeight(0), EXPLORER_MIN_HEIGHT);
});

test("keeps the responsive right panel default within useful limits", () => {
  assert.equal(getDefaultRightPanelWidth(700), 360);
  assert.equal(getDefaultRightPanelWidth(1366), 574);
  assert.equal(getDefaultRightPanelWidth(1920), 640);
});

test("reserves chat space while split panels are visible", () => {
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 700,
    rightPanelOpen: true,
    rightPanelWidth: 560,
  }), 380);
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 1366,
    rightPanelOpen: true,
    rightPanelWidth: 686,
  }), 260);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1024,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 344);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1366,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 686);
});

test("does not rewrite desktop widths while the file panel is in overlay mode", () => {
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 900,
    sidebarOpen: true,
    sidebarWidth: 480,
  }), 1200);
});
