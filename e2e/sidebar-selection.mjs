import assert from "node:assert/strict";

/** Runs only against the harness's temporary agent directory and dedicated fixtures. */
export async function checkSidebarSelection({ browser, base, post, api, ids }) {
  const [a, b, c] = ids;
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await post("/api/sessions/ui-state", { action: "set", ids, archived: false });
    await post("/api/sessions/ui-state", { action: "set", ids, pinned: true });
    const context = await browser.newContext({ viewport, locale: "en-US", hasTouch: viewport.width < 600 });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/?session=${b}`);
      const show = page.getByRole("button", { name: "Show sidebar", exact: true });
      // Restoring the URL session closes the phone drawer after hydration.
      // Wait for that transition before opening it for interaction.
      if (viewport.width < 600) await show.click();
      else if (await show.isVisible()) await show.click();
      const panel = page.locator("#session-sidebar-panel-sessions");
      const row = (id) => panel.locator(`[data-row-key="session:pinned:${id}"]`);
      await row(a).waitFor();
      await page.waitForFunction((roots) => roots.every((id) => {
        const link = document.querySelector(`[data-row-key="session:pinned:${id}"] a`);
        return link && !link.title.includes("\n…");
      }), ids);
      await row(a).hover();
      await row(a).getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Select sessions…", exact: true }).click();
      const bar = panel.locator(".sidebar-selection-bar");
      const checkbox = (id) => row(id).getByRole("checkbox");
      await checkbox(a).waitFor();
      assert.equal(await checkbox(a).isChecked(), true);
      assert.equal(await checkbox(b).isChecked(), false);
      // Title/label taps and native Space both toggle without navigation.
      if (viewport.width < 600) await row(c).locator("label").tap();
      else { await checkbox(c).focus(); await page.keyboard.press("Space"); }
      assert.equal(await checkbox(c).isChecked(), true);
      assert.match(page.url(), new RegExp(`session=${b}`));
      await bar.getByText("2 selected", { exact: true }).waitFor();
      await bar.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByText("Delete 2 selected sessions and their subagent sessions and side chats? This cannot be undone.", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".sidebar-menu-question").waitFor({ state: "hidden" });
      assert.equal(await checkbox(c).isChecked(), true, "Escape cancels only the question first");
      await checkbox(c).focus();
      await page.keyboard.press("Escape");
      await bar.waitFor({ state: "hidden" });
      await row(a).locator("a").waitFor();
      assert.match(page.url(), new RegExp(`session=${b}`));
      // Re-enter and archive only A and C, retaining B. Existing Undo restores pins.
      await row(a).hover();
      await row(a).getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Select sessions…", exact: true }).click();
      await checkbox(c).check();
      await bar.getByRole("button", { name: "Archive", exact: true }).click();
      await row(a).waitFor({ state: "hidden" });
      await row(c).waitFor({ state: "hidden" });
      await row(b).waitFor();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await row(a).waitFor();
      await row(c).waitFor();
      await bar.getByRole("button", { name: "Done", exact: true }).click();
      await row(a).locator("a").waitFor();
      console.log(`PASS: ${viewport.width}px nonadjacent session checkboxes, local Escape, archive and Undo`);
    } finally {
      await context.close();
    }
  }
  // Let the last Undo drain before restoring fixture flags.
  await api("/api/sessions/ui-state");
  await post("/api/sessions/ui-state", { action: "set", ids, pinned: false });
}
