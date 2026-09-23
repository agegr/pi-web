import assert from "node:assert/strict";
import { minPaneWidthFor, CHAT_COLUMN_PADDING } from "../lib/pane-state.ts";

// pi#43: the pane minimum is no longer a fixed constant — it is derived from
// the chat content width setting (minPaneWidthFor(width) = width + 2 ×
// CHAT_COLUMN_PADDING). The pass seeds `pi-chat-content-width` explicitly at
// entry (its geometry must not depend on what checkChatAppearance left
// behind) and restores 820 before returning. Default width 820 → minimum
// 852; the slider floor is 820, so the geometry below can never shrink
// below that.
const CHAT_CONTENT_WIDTH_STORAGE_KEY = "pi-chat-content-width";
const SEEDED_CHAT_CONTENT_WIDTH = 820;
const DEFAULT_MIN_PANE_WIDTH = minPaneWidthFor(SEEDED_CHAT_CONTENT_WIDTH);
assert.equal(DEFAULT_MIN_PANE_WIDTH, SEEDED_CHAT_CONTENT_WIDTH + 2 * CHAT_COLUMN_PADDING,
  "the e2e geometry assumes minPaneWidthFor(820) = 820 + 2 × CHAT_COLUMN_PADDING");

// pi#9: the opt-in split view (pi#4 panes + pi#20 width-adaptive sizing) gets
// its own desktop-only pass. The classic flow in run.mjs is deliberately
// untouched — split stays OFF by default, so its assertions must keep passing
// unchanged. Every locator that reads chat content scopes to the focused pane
// via [data-chat-focused='true'] (exactly one per page, classic mode included),
// the pattern that stays valid with several panes mounted at once.
//
// pi#25: the shared tab strip is gone. Each pane column embeds its own header
// (role="tab", aria-selected, running dot, badge, close ✕) labeled
// "<project> · <session>" (the sentinel: "New · <project>"), the pane area
// itself carries role="tablist" + [data-split-pane-area], and new sessions are
// opened only from the sidebar. An overflow switcher appears whenever the
// open count exceeds floor(areaWidth / minPaneWidth).

export async function checkSplitPane(page, sessions) {
  const { longTitle, compactedTitle, longTailText } = sessions;
  // checkChatAppearance ends at a mobile viewport with the sidebar in its
  // mobile drawer state; the split view is desktop-only, so restore a wide
  // desktop viewport (pi#43: 2560×1440, because the derived 852 minimum fits
  // floor(2560/852) = 3 panes where the old 1680 geometry fit only 1) and
  // re-dock the sidebar before the pass. Seed the chat content width
  // explicitly and reload so the derived pane minimum is deterministic.
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.evaluate(({ key, value }) => {
    try { localStorage.setItem(key, value); } catch {}
  }, { key: CHAT_CONTENT_WIDTH_STORAGE_KEY, value: String(SEEDED_CHAT_CONTENT_WIDTH) });
  await page.reload({ waitUntil: "networkidle" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const chat = () => page.locator("[data-chat-focused='true']");
  const paneArea = page.locator("[data-split-pane-area]");
  const tabs = paneArea.getByRole("tab");
  const panes = paneArea.locator("> div");
  const overflowTrigger = page.locator("[data-pane-overflow-trigger]");
  const overflowMenu = page.locator("[data-pane-overflow-menu]");
  // The header's text is the attribution label plus the close ✕ glyph.
  const headerText = async (index) =>
    ((await tabs.nth(index).textContent()) ?? "").replace(/×\s*$/, "").trim();
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
  const assertExactPaneWidth = async (paneCount, expectedWidth) => {
    const boxes = await panes.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
    assert.equal(boxes.length, paneCount, `expected ${paneCount} mounted panes`);
    for (const box of boxes) {
      assert.ok(Math.abs(box.width - expectedWidth) < 1,
        `with ${paneCount} panes beyond capacity each must be ~${expectedWidth}px wide (got ${box.width})`);
    }
  };

  // The sidebar's project identity (one project = one workspace entry) is the
  // same root pane headers attribute by.
  const project = await page.evaluate(() => {
    const raw = localStorage.getItem("pi-web:last-open-by-workspace");
    const map = raw ? JSON.parse(raw) : {};
    const keys = Object.keys(map);
    if (keys.length !== 1) throw new Error(`expected one workspace key, got ${keys.length}`);
    return keys[0];
  });
  const projectName = project.split(/[/\\]/).filter(Boolean).pop();
  const richLabel = "Render **E2E markdown**";

  // 1. Opt-in from the toolbar: the current session becomes the only pane, and
  //    its embedded header attributes it as "<project> · <session>". The old
  //    shared strip (data-split-tablist) must be gone entirely.
  await page.getByRole("button", { name: "Enable split view" }).click();
  await tabs.first().waitFor();
  assert.equal(await tabs.count(), 1, "enabling split view opens the current session as the only pane");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "the single pane's header is selected");
  assert.equal(await headerText(0), `${projectName} · ${richLabel}`,
    "the embedded header shows <project> · <session>");
  // The pane frame and the ChatWindow subtree commit in adjacent renders under
  // concurrent React; wait for the focused chat before counting it.
  await chat().waitFor();
  assert.equal(await chat().count(), 1, "exactly one focused chat container");
  await assertPaneWidths(1, 1);
  assert.equal(await page.locator("[data-split-tablist]").count(), 0,
    "the strip row between the top bar and the pane area is gone");
  assert.equal(await paneArea.getAttribute("role"), "tablist",
    "the pane area owns the tablist semantics");

  // 2. A sidebar click opens a second pane and focuses it (split on).
  await page.locator(`[title="${longTitle}"]`).click();
  await tabs.nth(1).waitFor();
  assert.equal(await tabs.count(), 2, "selecting another session in split mode opens a second pane");
  assert.equal(await headerText(1), `${projectName} · ${longTitle}`,
    "session panes attribute as <project> · <session name>");
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true", "the newly opened pane is focused");
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "false", "the first pane's header is deselected");
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

  // 4b. pi#23: the focused pane reports usage/stats to the top-right topbar.
  //     Both panes hold sessions with messages, so after the focus bounce the
  //     stats button must be visible and driven by the newly focused pane
  //     (unfocused panes pass undefined and only the focused pane writes).
  const desktopStatsButton = page.getByRole("button", { name: "Session info", exact: true });
  await desktopStatsButton.waitFor({ state: "visible" });
  await tabs.nth(1).click();
  await chat().getByText(longTailText, { exact: true }).waitFor();
  await desktopStatsButton.waitFor({ state: "visible" },
    "the stats button must follow focus to the newly focused session pane");
  await tabs.nth(0).click();
  await chat().getByText("E2E final answer", { exact: true }).waitFor();

  // 5. A third pane: three panes at one third each. The sidebar is hidden
  //    after the click so the pane area tracks the full 2560px
  //    (floor(2560/852) = 3 with the seeded 820 width, pi#43).
  await page.locator(`[title="${compactedTitle}"]`).click();
  await tabs.nth(2).waitFor();
  assert.equal(await tabs.count(), 3, "a third session opens a third pane");
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  // The sidebar collapse animates its width over 0.2s, so wait for the equal
  // split to settle before measuring (no overflow, every pane ~1/3 of the
  // pane area).
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    const expected = area.clientWidth / 3;
    return panesList.length === 3
      && area.scrollWidth <= area.clientWidth
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - expected) < 1);
  }, null, { timeout: 10_000 });
  await assertPaneWidths(3, 3);
  // While every pane fits there is no overflow switcher anywhere.
  assert.equal(await page.locator("[data-pane-overflow]").count(), 0,
    "the overflow switcher is hidden while all panes fit");

  // 5b. Derived floor (pi#43): opening a fourth pane beyond the 2560px area's
  //     capacity (floor(2560/852) = 3) floors EVERY pane to exactly the
  //     derived minimum (820 + 2 × 16 = 852) and shows the overflow switcher.
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.locator('[title="Branch root"]').click();
  await tabs.nth(3).waitFor();
  assert.equal(await tabs.count(), 4, "a fourth session opens a fourth pane");
  await page.waitForFunction((minWidth) => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    return panesList.length === 4
      && area.scrollWidth > area.clientWidth
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - minWidth) < 1);
  }, DEFAULT_MIN_PANE_WIDTH, { timeout: 10_000 });
  await assertExactPaneWidth(4, DEFAULT_MIN_PANE_WIDTH);
  await overflowTrigger.waitFor({ state: "visible" });
  // Close the fourth pane and hide the sidebar again so the survivors return
  // to the full-area equal split before the viewport shrinks below.
  await tabs.nth(3).getByRole("button", { name: "Close tab" }).click();
  await page.waitForFunction((expected) => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.querySelectorAll("[role='tab']").length === expected;
  }, 3, { timeout: 10_000 });
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    const expected = area.clientWidth / 3;
    return panesList.length === 3
      && area.scrollWidth <= area.clientWidth
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - expected) < 1);
  }, null, { timeout: 10_000 });

  // 6. Width-adaptive floor (pi#20, pi#43): shrinking the viewport below
  //    2 × the derived minimum makes every pane exactly minPaneWidthFor(820)
  //    = 852 and the pane area scroll horizontally; restoring the width
  //    brings the equal split back without horizontal scrolling.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForFunction((minPaneWidth) => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    return panesList.length === 3
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - minPaneWidth) < 1)
      && area.scrollWidth > area.clientWidth;
  }, DEFAULT_MIN_PANE_WIDTH, { timeout: 10_000 });
  await assertExactPaneWidth(3, DEFAULT_MIN_PANE_WIDTH);
  // 6b. Overflow switcher (pi#25): at 900px the area holds floor(900/852) = 1
  //     pane, so 3 open panes make the switcher appear. Its menu lists every
  //     open pane with its attribution label, and activating an entry scrolls
  //     the pane into view and focuses it.
  await overflowTrigger.waitFor({ state: "visible" });
  await overflowTrigger.click();
  await overflowMenu.waitFor({ state: "visible" });
  const menuEntries = overflowMenu.locator("[role='menuitem']");
  assert.equal(await menuEntries.count(), 3, "the overflow menu lists every open pane");
  for (let i = 0; i < 3; i++) {
    const text = (await menuEntries.nth(i).textContent()) ?? "";
    assert.ok(text.startsWith(`${projectName} · `),
      `menu entry ${i} carries the pane attribution label (got ${text})`);
  }
  // Activate the middle pane's entry: it scrolls the pane into view, focuses
  // it (aria-selected moves), and closes the menu.
  await menuEntries.nth(1).click();
  await overflowMenu.waitFor({ state: "hidden" });
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true",
    "overflow entry activation focuses the target pane");
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const pane = area.children[1];
    return pane && area.scrollLeft + area.clientWidth >= pane.offsetLeft + pane.offsetWidth - 1;
  }, null, { timeout: 10_000 });
  // Esc also closes the dropdown when it is reopened.
  await overflowTrigger.click();
  await overflowMenu.waitFor({ state: "visible" });
  await overflowMenu.press("Escape");
  await overflowMenu.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.scrollWidth === area.clientWidth;
  }, null, { timeout: 10_000 });
  await assertPaneWidths(3, 3);
  assert.equal(await page.locator("[data-pane-overflow]").count(), 0,
    "the overflow switcher hides again once all panes fit");
  // Restore focus to the third pane so step 7 closes the focused pane.
  await tabs.nth(2).click();
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const third = area.querySelectorAll("[role='tab']")[2];
    return third && third.getAttribute("aria-selected") === "true";
  }, null, { timeout: 10_000 });

  // 7. Closing the focused pane drops to two tabs and the survivors re-widen.
  await tabs.nth(2).getByRole("button", { name: "Close tab" }).click();
  await page.waitForFunction((expected) => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.querySelectorAll("[role='tab']").length === expected;
  }, 2, { timeout: 10_000 });
  await assertPaneWidths(2, 2);
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true",
    "closing the focused pane focuses the last remaining pane");
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "false");

  // 7b. The setting drives the minimum live (pi#43): useChatAppearance is
  //     useSyncExternalStore-based, so moving the existing settings slider
  //     re-lays out the open panes in the same render pass (no reload — pane
  //     tabs are not persisted, so a reload would collapse to one pane).
  //     The sidebar's Settings button is the sole entry to the panel, so
  //     re-dock the sidebar first (its ~2300px pane area keeps capacity
  //     floor(2300/2032) = 1 < 2 panes). Width 2000 → minimum 2032: both
  //     panes floor to exactly 2032 and the overflow switcher appears.
  const wideMinPaneWidth = minPaneWidthFor(2000);
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("slider", { name: "Chat content width", exact: true }).press("End");
  await page.keyboard.press("Escape");
  await page.waitForFunction((minWidth) => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    return panesList.length === 2
      && area.scrollWidth > area.clientWidth
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - minWidth) < 1);
  }, wideMinPaneWidth, { timeout: 10_000 });
  await assertExactPaneWidth(2, wideMinPaneWidth);
  await overflowTrigger.waitFor({ state: "visible" });
  // Back to 820 (the slider floor): the panes re-widen to the equal split in
  // the same pass and the overflow switcher hides again.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("slider", { name: "Chat content width", exact: true }).press("Home");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const area = document.querySelector("[data-split-pane-area]");
    if (!area) return false;
    const panesList = Array.from(area.children);
    const expected = area.clientWidth / 2;
    return panesList.length === 2
      && area.scrollWidth <= area.clientWidth
      && panesList.every((pane) => Math.abs(pane.getBoundingClientRect().width - expected) < 1);
  }, null, { timeout: 10_000 });
  assert.equal(await page.locator("[data-pane-overflow]").count(), 0,
    "the overflow switcher hides again once the panes re-widen");

  // 8. New sessions come from the sidebar only (pi#25): the strip's "+"
  //    button no longer exists, so a pinned project group's "+" is the entry.
  //    Pin the workspace through the cwd picker so the pinned-group header
  //    (with its own "+") appears. The sidebar is already docked (7b left it
  //    open so its Settings button was reachable).
  assert.equal(await page.getByRole("button", { name: "New", exact: true }).count(), 0,
    "the sidebar header exposes no New button");
  assert.equal(await page.locator("[data-split-tablist]").count(), 0,
    "the strip is gone: no + button exists in the pane chrome");
  // The workspace is still the project (only session panes are open), so the
  // cwd picker only needs to pin it: pinning makes the pinned-group header
  // (with its own "+") appear.
  await page.locator("[data-cwd-picker]").click();
  await page.getByRole("button", { name: "Pin project", exact: true }).click();
  await tabs.nth(0).click();
  const groupNewSession = page.getByRole("button", { name: `New session in ${project}`, exact: true });
  await groupNewSession.waitFor();
  // The composer is scoped by PANE INDEX (panes map 1:1 to headers in order):
  // the empty new-session page renders no message area, so there is no
  // data-chat-focused to scope by inside the sentinel pane. Each call site
  // passes the sentinel's known tab index.
  const composer = (index) => panes.nth(index).locator(".chat-input-textarea");
  await groupNewSession.click();
  await tabs.nth(2).waitFor();
  assert.equal(await tabs.count(), 3, "the group + opens the new-session pane rightmost");
  assert.equal(await headerText(2), `New · ${projectName}`,
    "the sentinel pane's header shows New · <project>");
  assert.equal(await tabs.nth(2).getAttribute("aria-selected"), "true",
    "the new-session pane is focused when opened");
  await composer(2).waitFor({ state: "visible" });

  // 9. Draft survival: the new-session composer keeps its text across pane
  //    switches, and a second group "+" re-focuses the existing sentinel
  //    instead of duplicating it (at most one new-session tab by construction).
  await composer(2).fill("E2E new-session draft");
  await tabs.nth(0).click();
  await chat().getByText("E2E final answer", { exact: true }).waitFor();
  await groupNewSession.click();
  assert.equal(await tabs.count(), 3, "the group + focuses the existing new-session tab");
  assert.equal(await tabs.nth(2).getAttribute("aria-selected"), "true",
    "the existing new-session tab is re-focused");
  assert.equal(await composer(2).inputValue(), "E2E new-session draft",
    "the new-session draft survives pane switches");

  // 10. Auto new-session page: closing the last session pane keeps split view
  //     enabled with the focused new-session tab instead of the classic revert.
  await tabs.nth(0).getByRole("button", { name: "Close tab" }).click();
  await page.waitForFunction((expected) => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.querySelectorAll("[role='tab']").length === expected;
  }, 2, { timeout: 10_000 });
  await tabs.nth(0).getByRole("button", { name: "Close tab" }).click();
  await page.waitForFunction((expected) => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.querySelectorAll("[role='tab']").length === expected;
  }, 1, { timeout: 10_000 });
  assert.equal(await tabs.count(), 1, "only the new-session tab remains");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true",
    "closing the last session pane focuses the new-session tab");
  assert.ok(await paneArea.isVisible(),
    "split view stays enabled after the last session pane closes");
  await composer(0).waitFor({ state: "visible" });
  // 10b. pi#23: the sentinel pane has no session and reports nothing (it
  //      never forwards the callbacks), and the last session pane nulled the
  //      global state when focus moved to the sentinel (blur cleanup), so the
  //      stats button stays hidden until a session pane is focused again.
  await desktopStatsButton.waitFor({ state: "hidden",
    timeout: 10_000 },
    "the stats button must hide when only the session-less new-session tab is focused");

  // 11. The group "+" re-focuses the sentinel; selecting a session supersedes
  //     it (its draft stays parked for the next "+"); the pinned group lists
  //     the project's sessions regardless of the current selection.
  await groupNewSession.click();
  assert.equal(await tabs.count(), 1, "the group + re-focuses the existing new-session tab (at most one by construction)");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true",
    "the group + re-focuses the existing new-session tab");
  await composer(0).waitFor({ state: "visible" });
  await page.locator(`[title="${longTitle}"]`).click();
  await page.waitForFunction((expected) => {
    const area = document.querySelector("[data-split-pane-area]");
    return area && area.querySelectorAll("[role='tab']").length === expected;
  }, 1, { timeout: 10_000 });
  assert.equal(await tabs.count(), 1, "selecting a session closes the superseded new-session tab");
  assert.equal(await headerText(0), `${projectName} · ${longTitle}`,
    "the superseding session pane attributes as <project> · <session name>");
  // pi#43: the 7b slider round-trip must have left the default width stored —
  // this is also the restore the mobile iteration's appearance checks rely on.
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), CHAT_CONTENT_WIDTH_STORAGE_KEY),
    String(SEEDED_CHAT_CONTENT_WIDTH),
    "the pass must leave pi-chat-content-width restored to 820",
  );
}
