// The picker's path field navigates: a typed folder lists its subdirectories
// without pressing Go, and "Select this folder" is enabled as soon as the list
// is that folder's. A path that cannot be opened keeps the last folder listed.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

/** Two sibling folders with distinct children, outside every session's cwd. */
export function createDirectoryPickerFixtures(agentDir) {
  const root = join(agentDir, "picker");
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  for (const path of [join(alpha, "alpha-one"), join(alpha, "alpha-two"), join(beta, "beta-only")]) {
    mkdirSync(path, { recursive: true });
  }
  return { root, alpha, beta };
}

export async function checkDirectoryPicker({ page, fixture }) {
  const files = page.locator("#session-sidebar-panel-files");
  await showSidebarFiles(page);

  const openPicker = async () => {
    await files.locator(".project-picker-button.is-project").first().click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    await menu.getByRole("menuitem", { name: /^(Open another project…|Custom path…)$/ }).click();
    const panel = page.locator(".directory-picker-panel");
    await panel.waitFor({ state: "visible" });
    return panel;
  };

  const panel = await openPicker();
  const input = panel.locator("input.directory-picker-path").first();
  const entries = panel.locator(".directory-picker-entry");
  const hint = panel.locator(".directory-picker-hint");
  const select = panel.getByRole("button", { name: "Select this folder", exact: true });

  await input.fill(fixture.alpha);
  await entries.filter({ hasText: "alpha-one" }).first().waitFor();
  assert.equal(await entries.filter({ hasText: "alpha-two" }).count() > 0, true, "the typed folder's children are listed");
  assert.equal(await entries.filter({ hasText: "beta-only" }).count(), 0, "the previous folder's children are gone");
  assert.equal(await select.isDisabled(), false, "select needs no Go first");

  await input.fill(join(fixture.root, "missing"));
  await hint.waitFor();
  assert.match(await hint.innerText(), /missing/, "the hint names the path that failed");
  assert.equal(await entries.filter({ hasText: "alpha-one" }).count() > 0, true, "the last folder it could open stays listed");
  assert.equal(await select.isDisabled(), true, "an unopened path cannot be selected");

  await input.fill(fixture.alpha);
  await hint.waitFor({ state: "hidden" });
  assert.equal(await select.isDisabled(), false, "typing a valid path again enables select");

  await select.click();
  await panel.waitFor({ state: "detached" });

  const reopened = await openPicker();
  await reopened.locator(".directory-picker-entry").filter({ hasText: "alpha-one" }).first().waitFor();
  await page.keyboard.press("Escape");
  await reopened.waitFor({ state: "detached" });
  console.log("PASS: directory picker lists a typed path and selects it without Go");
}
