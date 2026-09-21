import assert from "node:assert/strict";

// pi#9: the opt-in split view (pi#4 panes + pi#13 count-adaptive sizing) gets
// its own desktop-only pass. The classic flow in run.mjs is deliberately
// untouched — split stays OFF by default, so its assertions must keep passing
// unchanged. Every locator that reads chat content scopes to the focused pane
// via [data-chat-focused='true'] (exactly one per page, classic mode included),
// the pattern that stays valid with several panes mounted at once.

export async function checkSplitPane(page, sessions) {
  const { longTitle, compactedTitle, longTailText } = sessions;
  // checkChatAppearance ends at a mobile viewport with the sidebar in its
  // mobile drawer state; the split view is desktop-only, so restore the desktop
  // viewport and re-dock the sidebar before the pass.
  await page.setViewportSize({ width: 1280, height: 800 });
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const chat = () => page.locator("[data-chat-focused='true']");
  const tabs = page.getByRole("tab");
  const paneArea = page.locator("[role='tablist'] + div");
  const panes = paneArea.locator("> div");
  const assertPaneWidths = async (paneCount, denominator) => {
    const areaBox = await paneArea.boundingBox();
    const boxes = await panes.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
    assert.equal(boxes.length, paneCount, `expected ${paneCount} mounted panes`);
    for (const box of boxes) {
      const expected = areaBox.width / denominator;
      assert.ok(Math.abs(box.width - expected) < 2,
        `with ${paneCount} panes at 1/${denominator} each must be ~${expected}px wide (got ${box.width})`);
    }
  };

  // 1. Opt-in from the toolbar: the current session becomes the only pane.
  await page.getByRole("button", { name: "Enable split view" }).click();
  await tabs.first().waitFor();
  assert.equal(await tabs.count(), 1, "enabling split view opens the current session as the only pane");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "the single pane's tab is selected");
  assert.equal(await chat().count(), 1, "exactly one focused chat container");
  await assertPaneWidths(1, 1);

  // 2. A sidebar click opens a second pane and focuses it (split on).
  await page.locator(`[title="${longTitle}"]`).click();
  await tabs.nth(1).waitFor();
  assert.equal(await tabs.count(), 2, "selecting another session in split mode opens a second pane");
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true", "the newly opened pane is focused");
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "false", "the first pane's tab is deselected");
  await assertPaneWidths(2, 2);

  // 3. Multi-pane mount + focused-pane scoping: the unfocused pane stays
  //    mounted with its content, while [data-chat-focused] sees only the
  //    focused pane's chat.
  await chat().getByText(longTailText, { exact: true }).waitFor();
  assert.equal(await chat().getByText("E2E final answer", { exact: true }).count(), 0,
    "the focused chat container must not contain another pane's content");
  assert.equal(await page.getByText("E2E final answer", { exact: true }).count(), 1,
    "the unfocused pane stays mounted with its content (no unmount on focus switch)");

  // 4. Pane state survives focus switches: expand process details in the
  //    first pane, bounce focus away and back, and it must still be expanded —
  //    the split-mode counterpart of the classic remount assertion.
  await tabs.nth(0).click();
  await chat().getByText("E2E final answer", { exact: true }).waitFor();
  const process = chat().getByRole("button", { name: /^Process details/ });
  assert.equal(await process.getAttribute("aria-expanded"), "false");
  await process.click();
  assert.equal(await process.getAttribute("aria-expanded"), "true");
  await tabs.nth(1).click();
  await chat().getByText(longTailText, { exact: true }).waitFor();
  await tabs.nth(0).click();
  await chat().getByText("E2E final answer", { exact: true }).waitFor();
  assert.equal(await process.getAttribute("aria-expanded"), "true",
    "pane state must survive focus switches without unmounting");

  // 5. A third pane: three panes at one third each (maxVisiblePanes default 3).
  await page.locator(`[title="${compactedTitle}"]`).click();
  await tabs.nth(2).waitFor();
  assert.equal(await tabs.count(), 3, "a third session opens a third pane");
  await assertPaneWidths(3, 3);

  // 6. Cycling maxVisiblePanes 3→2 keeps every pane half-wide and makes the
  //    pane area scroll horizontally (pi#13).
  await page.getByRole("button", { name: /Max visible panes: 3\./ }).click();
  await page.waitForFunction(() => {
    const area = document.querySelector("[role='tablist'] + div");
    return area && area.scrollWidth > area.clientWidth;
  }, null, { timeout: 10_000 });
  await assertPaneWidths(3, 2);

  // 7. Closing the focused pane drops to two tabs and the survivors re-widen.
  await tabs.nth(2).getByRole("button", { name: "Close tab" }).click();
  await page.waitForFunction((expected) => document.querySelectorAll("[role='tab']").length === expected, 2,
    { timeout: 10_000 });
  await assertPaneWidths(2, 2);
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true",
    "closing the focused pane focuses the last remaining pane");
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "false");
}
