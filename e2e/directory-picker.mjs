// The picker's path field selects what it holds: a typed folder is selected
// with "Select this folder" and no Go first, browsed on the way so the choice is
// the folder's real path, as Go + Select gives. Enter/Go still only browses.
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, sep } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

/** Two sibling folders with distinct children, outside every session's cwd. */
export function createDirectoryPickerFixtures(agentDir) {
  const root = join(agentDir, "picker");
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  for (const path of [join(alpha, "alpha-one"), join(alpha, "alpha-two"), join(beta, "beta-only")]) {
    mkdirSync(path, { recursive: true });
  }
  symlinkSync(alpha, join(root, "alpha-link"), "junction");
  return {
    root,
    // As the browse route lists them: what Select picks, however it was typed.
    alpha: realpathSync(alpha),
    beta: realpathSync(beta),
    // A `..`, a link and a trailing slash (and on macOS a linked temp dir).
    typedAlpha: [root, "beta", "..", "alpha-link", ""].join(sep),
  };
}

/** Its own context: the refused path's 404 is a console error the main pages count. */
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
    // Dev's StrictMode browses twice on open, and the later answer rewrites the
    // field: type only once no browse is still running.
    const isBrowse = (request) => new URL(request.url()).pathname === "/api/cwd/browse";
    let browsing = 0;
    const validates = [];
    page.on("request", (request) => {
      if (isBrowse(request)) browsing += 1;
      if (new URL(request.url()).pathname === "/api/cwd/validate") validates.push(request.postData());
    });
    for (const event of ["requestfinished", "requestfailed"]) {
      page.on(event, (request) => { if (isBrowse(request)) browsing -= 1; });
    }
    const nextFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The sidebar's first session list: the page is mounted, so the first click
    // on the project box opens its menu.
    const mounted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/sessions");
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await mounted;
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
      await panel.getByText("Loading directories…").waitFor({ state: "detached" });
      for (const deadline = Date.now() + 10_000; browsing > 0;) {
        assert.ok(Date.now() < deadline, "the picker's browse requests finish");
        await nextFrames();
      }
      await nextFrames();
      return {
        panel,
        input: panel.locator("input.directory-picker-path").first(),
        entries: panel.locator(".directory-picker-entry"),
        select: panel.getByRole("button", { name: "Select this folder", exact: true }),
        cancel: panel.getByRole("button", { name: "Cancel", exact: true }),
        create: panel.getByRole("button", { name: "New directory", exact: true }),
      };
    };
    const projectIs = (path) => page.waitForFunction(
      (expected) => document.querySelector("#session-sidebar-panel-files .project-picker-button.is-project")?.getAttribute("title") === expected,
      path,
    );

    let picker = await openPicker();
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(await picker.input.evaluate((input, fields) => {
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...fields });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      }, composing), true, "IME confirmation must not submit the browse form");
    }
    await picker.create.click();
    const newName = page.locator("#new-directory-name");
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(await newName.evaluate((input, fields) => {
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...fields });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      }, composing), true, "IME confirmation must not create a directory");
    }
    await newName.press("Escape");
    await picker.input.fill(fixture.typedAlpha);
    assert.equal(await picker.select.isDisabled(), false, "a typed folder needs no Go before Select");
    assert.equal(await picker.create.isDisabled(), true, "New directory still waits for the list to be that folder");
    await picker.select.click();
    await picker.panel.waitFor({ state: "detached" });
    await projectIs(fixture.alpha);

    picker = await openPicker();
    await picker.entries.filter({ hasText: "alpha-one" }).first().waitFor();
    assert.equal(await picker.input.inputValue(), fixture.alpha, "reopening lands on the chosen folder");
    await picker.input.fill(join(fixture.root, "missing"));
    await picker.select.click();
    await picker.panel.getByText("Directory does not exist", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains("directory-picker-path")),
      true,
      "a refusal puts focus back in the path field",
    );
    await page.keyboard.press("Escape");
    await picker.panel.waitFor({ state: "detached" });
    await projectIs(fixture.alpha);

    // Cancelled while Select still browses: nothing is selected.
    picker = await openPicker();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holdBrowse = async (route) => { await held; await route.continue(); };
    await page.route((url) => url.pathname === "/api/cwd/browse", holdBrowse);
    const validateCount = validates.length;
    await picker.input.fill(fixture.beta);
    await picker.select.click();
    await picker.cancel.click();
    await picker.panel.waitFor({ state: "detached" });
    const answered = page.waitForResponse((response) => isBrowse(response.request()));
    release();
    await answered;
    await page.unroute((url) => url.pathname === "/api/cwd/browse", holdBrowse);
    await nextFrames();
    assert.equal(validates.length, validateCount, "a cancelled Select validates nothing");
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
    console.log("PASS: directory picker selects a typed path's real folder without Go and shows a refused one's error");
  } finally {
    await context.close();
  }
}
