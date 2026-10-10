// Issue #1167: a sidebar session opens in a new browser tab (middle-click,
// Ctrl/Cmd-click, the row menu's "Open in new tab") while a plain click or
// Enter keeps selecting it in this tab. Desktop Chromium; one browser context,
// so the tabs share localStorage (workspace memory) as real tabs do.
import assert from "node:assert/strict";
import { join } from "node:path";

const FORBIDDEN_COMMANDS = new Set(["prompt", "steer", "follow_up", "fork", "fork_branch", "clone", "new_session"]);

export async function checkSessionNavigation({ browser, base, artifacts, a, b, api, deleteSession }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const errors = [];
  const watch = (target) => {
    target.on("pageerror", (error) => errors.push(error.message));
    target.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    target.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
  };
  // Nothing on these paths may create, copy or prompt a session: opening one
  // in a tab only loads it (and resumes its wrapper, as any open does).
  const forbidden = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.href.startsWith(base)) return;
    if (url.pathname === "/api/agent/new" || /^\/api\/sessions\/[^/]+\/fork$/.test(url.pathname)) {
      forbidden.push(`${request.method()} ${url.pathname}`);
      return;
    }
    if (request.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(url.pathname)) {
      const type = request.postDataJSON()?.type;
      if (FORBIDDEN_COMMANDS.has(type)) forbidden.push(`POST ${url.pathname} ${type}`);
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  watch(page);
  const sessionIds = async () => (await api("/api/sessions")).sessions.map((session) => session.id).sort();
  const initialIds = await sessionIds();

  const panel = (target) => target.locator("#session-sidebar-panel-sessions");
  const row = (target, id, where = "group") => panel(target).locator(`[data-row-key="session:${where}:${id}"]`);
  const link = (target, id, where = "group") => row(target, id, where).locator("a.session-tree-main");
  const content = {
    [a.id]: (target) => target.locator(`[data-entry-id="${a.entry}"]:not([data-message-role])`).filter({ hasText: a.text }),
    [b.id]: (target) => target.locator(`[data-entry-id="${b.entry}"]:not([data-message-role])`).filter({ hasText: b.text }),
  };
  // A tab shows `id`: its URL, the one selected row, and that session's own
  // message. An archived session has no row in the main tree (the archive
  // view is closed in a new tab), so only its URL and message are checked.
  const expectShows = async (target, id, { archived = false } = {}) => {
    await target.waitForFunction((expected) => new URLSearchParams(location.search).get("session") === expected, id);
    if (!archived) {
      await panel(target).locator(`[data-row-key$=":${id}"] a.session-tree-main[aria-current="true"]`).waitFor();
      assert.equal(await panel(target).locator('.session-tree-main[aria-current="true"]').count(), 1, "one selected row");
    }
    await content[id](target).waitFor({ state: "visible" });
  };
  const newTab = async (open) => {
    const opened = context.waitForEvent("page");
    await open();
    const tab = await opened;
    watch(tab);
    // A cold tab under `next dev` may wait on a compile.
    tab.setDefaultTimeout(60_000);
    // A new tab starts on about:blank before it navigates to the link.
    await tab.waitForURL((url) => url.href !== "about:blank", { waitUntil: "domcontentloaded" });
    return tab;
  };
  const markDocument = (target) => target.evaluate(() => { window.__piNavMarker = "kept"; });
  const documentKept = (target) => target.evaluate(() => window.__piNavMarker === "kept");

  try {
    await page.goto(`${base}/?session=${a.id}`, { waitUntil: "domcontentloaded" });
    await expectShows(page, a.id);
    for (const id of [a.id, b.id]) {
      assert.equal(await link(page, id).getAttribute("href"), `?session=${id}`);
      assert.equal(await link(page, id).getAttribute("target"), null);
    }

    // A plain click selects in this tab, in place: no new tab, no page load.
    await markDocument(page);
    await link(page, b.id).click();
    await expectShows(page, b.id);
    assert.ok(await documentKept(page), "a plain click must not reload the page");
    assert.equal(context.pages().length, 1);
    // Enter on the focused link does the same.
    await link(page, a.id).focus();
    await page.keyboard.press("Enter");
    await expectShows(page, a.id);
    assert.ok(await documentKept(page), "Enter must not reload the page");
    assert.equal(context.pages().length, 1);
    console.log("PASS: plain click and Enter select a session in the same tab without a page load");

    // Ctrl-click and middle-click open B in another tab; this one stays on A.
    for (const [label, open] of [
      ["Ctrl+click", () => link(page, b.id).click({ modifiers: ["Control"] })],
      ["middle-click", () => link(page, b.id).click({ button: "middle" })],
    ]) {
      const tab = await newTab(open);
      assert.equal(new URL(tab.url()).searchParams.get("session"), b.id, label);
      await expectShows(tab, b.id);
      await expectShows(page, a.id);
      assert.ok(await documentKept(page), `${label} must not reload the original tab`);
      await tab.close();
    }
    console.log("PASS: Ctrl+click and middle-click open the session in a new tab; the original tab keeps its session");

    // The built-in right-click menu offers it and opens the row it was opened on.
    await row(page, b.id).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Session actions" });
    await menu.waitFor();
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map((text) => text.split("\n")[0].trim());
    // After the actions that manage the session, just before Delete; never first (it would take the focus).
    assert.deepEqual(items.slice(-2), ["Open in new tab", "Delete…"], `menu items: ${items.join(" | ")}`);
    assert.equal(items[items.length - 3], "Archive", `menu items: ${items.join(" | ")}`);
    let tab = await newTab(() => menu.getByRole("menuitem", { name: /^Open in new tab/ }).click());
    await expectShows(tab, b.id);
    await expectShows(page, a.id);
    await tab.close();
    // ⋯ has the same item; T is its shortcut.
    await row(page, b.id).hover();
    await row(page, b.id).getByRole("button", { name: "More actions" }).click();
    await menu.waitFor();
    tab = await newTab(() => page.keyboard.press("t"));
    await expectShows(tab, b.id);
    await expectShows(page, a.id);
    console.log("PASS: right-click and ⋯ menus open the clicked row's session in a new tab (click and T)");

    // Each tab keeps its own session through a reload, and an explicit
    // ?session= wins over the other tab's memory. The original tab reloads
    // last, so the shared workspace memory names A; the new tab's own memory
    // still brings B back on a bare URL.
    await tab.reload({ waitUntil: "domcontentloaded" });
    await expectShows(tab, b.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectShows(page, a.id);
    await tab.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await expectShows(tab, b.id);
    await expectShows(page, a.id);
    await tab.close();
    console.log("PASS: two tabs keep their own sessions through reloads; tab memory and ?session= are not crossed");

    // Pinned and archived rows link the same way; pin, archive and restore never navigate.
    // (The reload above replaced the document: mark the new one.)
    await markDocument(page);
    await row(page, b.id).click({ button: "right" });
    await menu.getByRole("menuitem", { name: /^Pin/ }).click();
    await link(page, b.id, "pinned").waitFor();
    assert.equal(await link(page, b.id, "pinned").getAttribute("href"), `?session=${b.id}`);
    await expectShows(page, a.id);
    tab = await newTab(() => link(page, b.id, "pinned").click({ modifiers: ["Control"] }));
    await expectShows(tab, b.id);
    await tab.close();
    await row(page, b.id, "pinned").click({ button: "right" });
    await menu.getByRole("menuitem", { name: /^Unpin/ }).click();
    await link(page, b.id).waitFor();

    await row(page, b.id).hover();
    await row(page, b.id).getByRole("button", { name: "Archive", exact: true }).click();
    await row(page, b.id).waitFor({ state: "detached" });
    await expectShows(page, a.id);
    await panel(page).locator('[data-row-key="footer-archived"] button').click();
    await link(page, b.id, "archive").waitFor();
    assert.equal(await link(page, b.id, "archive").getAttribute("href"), `?session=${b.id}`);
    tab = await newTab(() => link(page, b.id, "archive").click({ modifiers: ["Control"] }));
    await expectShows(tab, b.id, { archived: true });
    await tab.close();
    await row(page, b.id, "archive").hover();
    await row(page, b.id, "archive").getByRole("button", { name: "Restore", exact: true }).click();
    await page.locator(".sidebar-archive-back").click();
    await link(page, b.id).waitFor();
    await expectShows(page, a.id);
    assert.ok(await documentKept(page), "pin, archive and restore must not reload the page");
    console.log("PASS: pinned and archived rows link and open in new tabs; pin, archive and restore do not navigate");

    assert.deepEqual(forbidden, [], "opening sessions in tabs must not create, copy or prompt any");
    assert.deepEqual(await sessionIds(), initialIds, "no session was created");
    console.log("PASS: no session created, copied or prompted while opening tabs");

    // A link to a session that does not exist selects and shows no session
    // in a profile with nothing remembered. Known, pre-existing (f98c088 does
    // the same): a profile that already opened a session of that project falls
    // back to it through the workspace memory (AppShell's
    // restoreWorkspaceContext), so that case is not asserted here.
    const freshContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    try {
      const missing = await freshContext.newPage();
      // Uncaught errors only: the 404 for the missing session is logged as a console error by design.
      missing.on("pageerror", (error) => errors.push(error.message));
      await missing.goto(`${base}/?session=e2e-does-not-exist`, { waitUntil: "domcontentloaded" });
      await panel(missing).locator(".session-tree-session").first().waitFor();
      await missing.waitForTimeout(1500);
      assert.equal(await panel(missing).locator('.session-tree-main[aria-current="true"]').count(), 0, "no row selected for a missing session");
      const shown = new URL(missing.url()).searchParams.get("session");
      assert.ok(shown === null || shown === "e2e-does-not-exist", `URL moved to session ${shown}`);
      for (const id of [a.id, b.id]) assert.equal(await content[id](missing).count(), 0, `missing link shows ${id}`);
    } finally {
      await freshContext.close();
    }
    console.log("PASS: a link to a missing session selects and shows no other session (fresh profile)");

    // Keyboard Fork: the copy's row takes focus on its link (the row's first
    // control), not on its archive button. The copy is deleted afterwards.
    await link(page, b.id).focus();
    await page.keyboard.press("Shift+F10");
    await menu.waitFor();
    const forked = page.waitForResponse((response) => response.url() === `${base}/api/sessions/${b.id}/fork` && response.request().method() === "POST");
    await page.keyboard.press("f");
    const copyId = (await (await forked).json()).session.id;
    try {
      await page.waitForFunction((key) => document.activeElement?.matches(`[data-row-key="${key}"] a.session-tree-main`) === true, `session:group:${copyId}`);
      assert.equal(await link(page, copyId).getAttribute("href"), `?session=${copyId}`);
      console.log("PASS: after a keyboard Fork, focus lands on the copy row's link");
    } finally {
      // A fresh document first: a stream the copy kept open (its grace window)
      // would ask for the deleted copy's state and log a 404, which is how any
      // tab reacts to a session deleted under it, not part of this check.
      await page.goto(`${base}/?session=${a.id}`, { waitUntil: "domcontentloaded" });
      await expectShows(page, a.id);
      await deleteSession(copyId);
    }
    assert.deepEqual(await sessionIds(), initialIds, "the fork's copy is gone");

    assert.deepEqual(errors, [], "browser errors while opening sessions in tabs");
    await context.tracing.stop();
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "session-navigation-failure.png") }).catch(() => {});
    await context.tracing.stop({ path: join(artifacts, "session-navigation-trace.zip") }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
