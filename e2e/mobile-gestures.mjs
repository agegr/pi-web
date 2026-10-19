import assert from "node:assert/strict";
import { showSidebarFiles } from "./sidebar.mjs";

/*
 * Touch gestures on a phone (hooks/useSwipePanel.ts, lib/swipe-gesture.ts, and
 * the sheet's dismissal in components/SidebarMenu.tsx): a swipe right from the
 * screen's left edge opens the sidebar drawer, a swipe left on the drawer
 * closes it, a swipe down on a bottom sheet dismisses it, and over the
 * full-screen file panel the edge swipe goes back (closes the panel).
 *
 * Chromium is driven through CDP touch events, so the pointer stream is a real
 * finger's (pointerType "touch"), not a mouse's.
 */

const EDGE_X = 6;
const DRAWER_WIDTH = 280;
/** The finger moves in steps with a frame between them, so a release has a hand's speed. */
const STEP_MS = 16;

function finger(cdp) {
  const point = (x, y) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  return {
    start: (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(x, y) }),
    move: (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) }),
    end: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
  };
}

async function drag(page, { from, to, steps = 4, whileDown }) {
  const cdp = await page.context().newCDPSession(page);
  const touch = finger(cdp);
  try {
    await touch.start(from.x, from.y);
    for (let step = 1; step <= steps; step++) {
      const x = from.x + (to.x - from.x) * (step / steps);
      const y = from.y + (to.y - from.y) * (step / steps);
      await touch.move(x, y);
      await page.waitForTimeout(STEP_MS);
    }
    if (whileDown) await whileDown();
    await touch.end();
  } finally {
    await cdp.detach();
  }
}

/** True once the drawer's slide has finished and it is on screen. */
function drawerIsOpen(page) {
  return page.locator("#session-sidebar").evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
    return element.getBoundingClientRect().right > 1;
  });
}

/** True once the file panel is showing (its instant close has finished). */
function filePanelIsOpen(page) {
  return page.locator("#file-panel").evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
    return element.getBoundingClientRect().width > 0;
  });
}

export async function checkMobileGestures(page, filePath) {
  assert.ok(page.viewportSize().width <= 640, "the gestures are the phone's");
  const sidebar = page.locator("#session-sidebar");
  const sheet = page.locator(".sidebar-sheet");
  assert.equal(await drawerIsOpen(page), false, "the drawer starts closed on a phone");

  // The strip starts below the top bar: its own drawer button stays a tap target.
  const headerCdp = await page.context().newCDPSession(page);
  const headerTap = finger(headerCdp);
  await headerTap.start(18, 18);
  await headerTap.end();
  await page.waitForTimeout(350);
  assert.equal(await drawerIsOpen(page), true, "the top bar's button still opens the drawer");
  // The open drawer covers the button; the dimmed chat beside it closes it.
  await headerTap.start(330, 400);
  await headerTap.end();
  await page.waitForTimeout(350);
  await headerCdp.detach();
  assert.equal(await drawerIsOpen(page), false, "the backdrop still closes it");

  // While the finger is down the drawer follows it: at 110px of 280 it is most
  // of the way in, with its dim layer part way up. Releasing there commits.
  let followed = null;
  await drag(page, {
    from: { x: EDGE_X, y: 420 },
    to: { x: 110, y: 423 },
    whileDown: async () => {
      followed = await page.evaluate(() => ({
        transform: getComputedStyle(document.querySelector("#session-sidebar")).transform,
        backdrop: getComputedStyle(document.querySelector(".sidebar-overlay-backdrop")).opacity,
      }));
    },
  });
  const offset = Number(/matrix\(1, 0, 0, 1, (-?\d+(?:\.\d+)?), 0\)/.exec(followed.transform)?.[1] ?? NaN);
  assert.ok(offset < -120 && offset > -220, `the drawer follows the finger (got ${followed.transform})`);
  assert.ok(Number(followed.backdrop) > 0.2 && Number(followed.backdrop) < 0.8, `the dim layer follows too (got ${followed.backdrop})`);
  assert.equal(await drawerIsOpen(page), true, "a drag past a third of the drawer opens it");

  // The drawer itself answers a swipe left.
  const selectedBefore = new URL(page.url()).searchParams.get("session");
  const row = sidebar.locator(".session-tree-session").first();
  await row.waitFor();
  const rowBox = await row.boundingBox();
  await drag(page, {
    from: { x: rowBox.x + rowBox.width - 12, y: rowBox.y + rowBox.height / 2 },
    to: { x: rowBox.x + rowBox.width - 12 - DRAWER_WIDTH, y: rowBox.y + rowBox.height / 2 + 4 },
  });
  assert.equal(await drawerIsOpen(page), false, "a swipe left closes the drawer");
  assert.equal(new URL(page.url()).searchParams.get("session"), selectedBefore, "the swipe does not select the row under it");

  // A short drag falls short of the commit point and settles back.
  await drag(page, { from: { x: EDGE_X, y: 420 }, to: { x: 60, y: 420 }, steps: 12 });
  assert.equal(await drawerIsOpen(page), false, "a short drag does not open the drawer");
  const settled = await sidebar.evaluate((element) => getComputedStyle(element).transform);
  assert.ok(settled === "none" || /matrix\(1, 0, 0, 1, -280, 0\)/.test(settled), `it settles fully closed (got ${settled})`);

  // A tap on the edge stays a tap.
  const cdp = await page.context().newCDPSession(page);
  const touch = finger(cdp);
  await touch.start(EDGE_X, 300);
  await touch.end();
  await cdp.detach();
  assert.equal(await drawerIsOpen(page), false, "a tap on the edge is not a swipe");

  // A vertical drag from the edge is a scroll, not a drawer.
  await drag(page, { from: { x: EDGE_X, y: 500 }, to: { x: 12, y: 300 } });
  assert.equal(await drawerIsOpen(page), false, "a vertical drag from the edge does not open the drawer");

  // A row's menu is a bottom sheet on a phone: a swipe down dismisses it.
  await drag(page, { from: { x: EDGE_X, y: 420 }, to: { x: 260, y: 424 } });
  assert.equal(await drawerIsOpen(page), true);
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await sheet.waitFor();
  const sheetBox = await sheet.boundingBox();
  await drag(page, {
    from: { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + 8 },
    to: { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + 8 + 140 },
  });
  await sheet.waitFor({ state: "detached" });
  assert.equal(await drawerIsOpen(page), true, "dismissing the sheet leaves the drawer open");

  // A short pull on the sheet springs back instead of closing it.
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await sheet.waitFor();
  const springBox = await sheet.boundingBox();
  await drag(page, {
    from: { x: springBox.x + springBox.width / 2, y: springBox.y + 8 },
    to: { x: springBox.x + springBox.width / 2, y: springBox.y + 8 + 24 },
    steps: 10,
  });
  await page.waitForTimeout(250);
  assert.equal(await sheet.count(), 1, "a short pull leaves the sheet open");
  await page.locator(".sidebar-sheet-cancel").click();
  await sheet.waitFor({ state: "detached" });

  // A downward drag inside the sheet scrolls it, rather than dismissing it.
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await sheet.waitFor();
  const scrollBox = await sheet.boundingBox();
  await drag(page, {
    from: { x: scrollBox.x + scrollBox.width / 2, y: scrollBox.y + scrollBox.height - 30 },
    to: { x: scrollBox.x + scrollBox.width / 2, y: scrollBox.y + scrollBox.height - 140 },
  });
  await page.waitForTimeout(250);
  assert.equal(await sheet.count(), 1, "an upward drag scrolls the sheet instead of dismissing it");
  assert.ok(await sheet.evaluate((element) => element.scrollTop) >= 0);
  await page.locator(".sidebar-sheet-cancel").click();
  await sheet.waitFor({ state: "detached" });

  // Over the full-screen file panel, the edge swipe goes back and closes it.
  await showSidebarFiles(page);
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  await page.locator("#file-panel iframe").waitFor();
  assert.equal(await filePanelIsOpen(page), true, "the file panel opens full screen on a phone");
  await drag(page, { from: { x: EDGE_X, y: 420 }, to: { x: 240, y: 424 } });
  assert.equal(await filePanelIsOpen(page), false, "a swipe from the edge closes the file panel");
  assert.equal(await drawerIsOpen(page), false, "the edge swipe over the panel does not open the drawer");
  // With the panel gone, the edge belongs to the drawer again.
  await drag(page, { from: { x: EDGE_X, y: 420 }, to: { x: 260, y: 424 } });
  assert.equal(await drawerIsOpen(page), true, "the edge swipe opens the drawer again");

  console.log(`PASS: ${page.viewportSize().width}px edge-swipe drawer, drag follow, swipe-close, short drag, tap, scroll, sheet dismissal and panel back`);
}
