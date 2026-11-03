// Run against an existing dev server: node e2e/sidebar-position.mjs
// Optionally set E2E_BASE_URL and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  }),
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const page = await context.newPage();
  const url = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
  await page.goto(url);
  const sidebar = page.locator("#session-sidebar");
  await sidebar.waitFor();
  assert.equal((await sidebar.boundingBox()).x, 0);
  // Keep a reference: a layout change must not remount the sidebar.
  await sidebar.evaluate((node) => { window.__sidebarBeforeLayout = node; });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('input[name="sidebar-position"][value="right"]').check({ force: true });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('#session-sidebar').getBoundingClientRect().right === innerWidth);
  assert.equal(await sidebar.evaluate((node) => node === window.__sidebarBeforeLayout), true);
  const handle = page.locator('[data-resize-handle="sidebar"]');
  const before = await sidebar.boundingBox();
  const box = await handle.boundingBox();
  assert.ok(box.x <= before.x && box.x + box.width >= before.x);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  assert.ok((await sidebar.boundingBox()).width > before.width, "left arrow grows the right sidebar");
  const dragBefore = await sidebar.boundingBox();
  const dragHandle = await handle.boundingBox();
  await page.mouse.move(dragHandle.x + dragHandle.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(dragHandle.x - 40, 400, { steps: 5 });
  await page.mouse.up();
  assert.ok((await sidebar.boundingBox()).width > dragBefore.width, "dragging left grows the right sidebar");
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#session-sidebar')?.getBoundingClientRect().right === innerWidth);
  await page.getByRole("button", { name: "Show file panel", exact: true }).click();
  await page.waitForTimeout(300);
  const filePanel = page.locator("#file-panel");
  const fileBox = await filePanel.boundingBox();
  assert.ok(fileBox.width > 0);
  assert.ok(fileBox.x + fileBox.width <= (await sidebar.boundingBox()).x + 1, "file panel stays inside the right sidebar");
  await page.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await sidebar.evaluate(node => node.inert), true);
  assert.ok((await filePanel.boundingBox()).width >= 1438, "expanded file panel spans the viewport");
  await page.getByRole("button", { name: "Restore file panel width", exact: true }).click();
  await page.getByRole("button", { name: "Hide file panel", exact: true }).last().click();
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal((await sidebar.boundingBox()).width, 0);
  assert.equal(await sidebar.evaluate(node => getComputedStyle(node).borderLeftWidth), "0px");
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.waitForTimeout(250);
  // A second tab follows a storage change without being reloaded.
  const other = await context.newPage();
  await other.goto(url);
  await other.locator('#session-sidebar').waitFor();
  await page.evaluate(() => {
    localStorage.setItem("pi-web:sidebar-position", "left");
    window.dispatchEvent(new StorageEvent("storage", { key: "pi-web:sidebar-position" }));
  });
  await other.waitForFunction(() => document.querySelector('[data-sidebar-position]')?.dataset.sidebarPosition === 'left');
  assert.equal((await other.locator('#session-sidebar').boundingBox()).x, 0);
  await other.close();
  await page.bringToFront();
  await page.evaluate(() => {
    localStorage.setItem("pi-web:sidebar-position", "right");
    window.dispatchEvent(new StorageEvent("storage", { key: "pi-web:sidebar-position" }));
  });
  await page.waitForFunction(() => document.querySelector('#session-sidebar')?.getBoundingClientRect().right === innerWidth);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const node = document.querySelector('#session-sidebar');
    return node?.getBoundingClientRect().right <= 0 && !node.classList.contains('sidebar-mobile-pending');
  });
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#session-sidebar')?.getBoundingClientRect().x === 0);
  assert.equal((await sidebar.boundingBox()).x, 0, "phone keeps its left drawer");
  console.log("Sidebar position: settings, live layout, resize, persistence, cross-tab and phone checks passed.");
} finally {
  await browser.close();
}
