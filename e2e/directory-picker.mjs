// The picker's path field selects what it holds: a typed folder is selected
// with "Select this folder" and no Go first, validated like any selection.
// Enter/Go still only browses.
import assert from "node:assert/strict";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

/** Two sibling folders with distinct children, outside every session's cwd. */
export function createDirectoryPickerFixtures(agentDir) {
  // Real paths: a typed path is selected as typed, the list shows the real one.
  const root = join(realpathSync(agentDir), "picker");
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  for (const path of [join(alpha, "alpha-one"), join(alpha, "alpha-two"), join(beta, "beta-only")]) {
    mkdirSync(path, { recursive: true });
  }
  return { root, alpha, beta };
}

/** Its own context: the refused path's 400 is a console error the main pages count. */
export async function checkDirectoryPicker({ browser, base, fixture }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const errors = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    const files = page.locator("#session-sidebar-panel-files");
    const project = files.locator(".project-picker-button.is-project").first();
    await showSidebarFiles(page);

    const openPicker = async () => {
      await project.click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      await menu.getByRole("menuitem", { name: /^(Open another project…|Custom path…)$/ }).click();
      const panel = page.locator(".directory-picker-panel");
      await panel.waitFor({ state: "visible" });
      return {
        panel,
        input: panel.locator("input.directory-picker-path").first(),
        entries: panel.locator(".directory-picker-entry"),
        select: panel.getByRole("button", { name: "Select this folder", exact: true }),
        create: panel.getByRole("button", { name: "New directory", exact: true }),
      };
    };
    const projectIs = (path) => page.waitForFunction(
      (expected) => document.querySelector("#session-sidebar-panel-files .project-picker-button.is-project")?.getAttribute("title") === expected,
      path,
    );

    let picker = await openPicker();
    await picker.panel.getByText("Loading directories…").waitFor({ state: "detached" });
    await picker.input.fill(fixture.alpha);
    assert.equal(await picker.select.isDisabled(), false, "a typed folder needs no Go before Select");
    assert.equal(await picker.create.isDisabled(), true, "New directory still waits for the list to be that folder");
    await picker.select.click();
    await picker.panel.waitFor({ state: "detached" });
    await projectIs(fixture.alpha);

    picker = await openPicker();
    await picker.entries.filter({ hasText: "alpha-one" }).first().waitFor();
    assert.equal(await picker.input.inputValue(), fixture.alpha, "reopening lands on the chosen folder");
    const missing = join(fixture.root, "missing");
    await picker.input.fill(missing);
    await picker.select.click();
    await picker.panel.getByText(`Directory does not exist: ${missing}`, { exact: true }).waitFor();
    assert.equal(await picker.panel.isVisible(), true, "a refused path keeps the picker open");
    // Select was disabled while it checked, so focus left the dialog: no Escape.
    await picker.panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await picker.panel.waitFor({ state: "detached" });
    await projectIs(fixture.alpha);

    picker = await openPicker();
    await picker.entries.filter({ hasText: "alpha-one" }).first().waitFor();
    await picker.input.fill(fixture.beta);
    await picker.input.press("Enter");
    await picker.entries.filter({ hasText: "beta-only" }).first().waitFor();
    assert.equal(await picker.entries.filter({ hasText: "alpha-one" }).count(), 0, "Enter browses the typed folder");
    assert.equal(await picker.create.isDisabled(), false);
    await page.keyboard.press("Escape");
    await picker.panel.waitFor({ state: "detached" });
    await projectIs(fixture.alpha);
    assert.deepEqual(errors, [], "Browser errors in the directory picker check");
    console.log("PASS: directory picker selects a typed path without Go and shows a refused one's error");
  } finally {
    await context.close();
  }
}
