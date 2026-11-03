import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarSessions } from "./sidebar.mjs";

/** Activity view with real session fixtures and simulated background-run polling. */
export async function checkSessionActivity({ browser, base, artifacts, api, currentId, runningId, manualId }) {
  const catalog = await api("/api/sessions");
  const runningSession = catalog.sessions.find((session) => session.id === runningId);
  assert.ok(runningSession?.lastMessagePreview, "the session catalogue exposes its latest text preview");
  assert.ok(runningSession.lastMessagePreview.length <= 240);

  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      locale: "en-US", colorScheme: mobile ? "dark" : "light", hasTouch: mobile, isMobile: mobile,
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const errors = [];
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /hydration|server rendered html/i.test(message.text())) errors.push(message.text());
      });
    });
    await context.addInitScript((id) => {
      if (location.origin === "null") return;
      if (!localStorage.getItem("activity-test-seeded")) {
        localStorage.setItem("pi-web:unread-session-ids", JSON.stringify([id]));
        localStorage.setItem("activity-test-seeded", "yes");
      }
    }, manualId);
    let running = true;
    await context.route("**/api/agent/running", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: {
        ...data,
        runningSessionIds: running ? [runningId] : [],
        awaitingInputSessionIds: [],
        subagentsActiveSessionIds: [],
        completionNotificationSuppressedSessionIds: [],
      } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(120_000);
    const bell = (target) => target.locator(".sidebar-activity-toggle");
    const activityRow = (target, id) => target.locator(`[data-activity-row-key=${JSON.stringify(`activity-session:${id}`)}]`);
    async function showSessions(target) {
      await target.locator("#session-sidebar:not(.sidebar-mobile-pending)").waitFor({ state: "attached" });
      const show = target.getByRole("button", { name: "Show sidebar", exact: true });
      const hide = target.getByRole("button", { name: "Hide sidebar", exact: true });
      await show.or(hide).first().waitFor({ state: "visible" });
      if (await show.isVisible()) await show.click();
      await target.waitForFunction(() => document.querySelector("#session-sidebar")?.classList.contains("sidebar-open"));
      await showSidebarSessions(target);
    }
    try {
      await page.goto(`${base}/?session=${currentId}`, { waitUntil: "domcontentloaded" });
      await showSessions(page);
      await bell(page).waitFor({ state: "visible" });
      assert.equal(await bell(page).locator(".sidebar-activity-badge").count(), 0, "manual unread is not a completed notification");
      await bell(page).click();
      assert.equal(await bell(page).getAttribute("aria-pressed"), "true");
      await activityRow(page, runningId).waitFor({ state: "visible" });
      await activityRow(page, manualId).waitFor({ state: "visible" });
      assert.equal(await activityRow(page, runningId).count(), 1);
      assert.equal(await activityRow(page, runningId).locator(".session-activity-preview").innerText(), runningSession.lastMessagePreview);
      assert.match(await activityRow(page, runningId).locator("a").getAttribute("href"), new RegExp(`session=${runningId}`));
      assert.ok(await page.locator('[data-activity-row-key="activity-header:priority"]').count());

      if (!mobile) {
        const resize = page.getByRole("separator", { name: "Resize sidebar", exact: true });
        await resize.press("Home");
        await page.waitForFunction(() => Math.abs(document.querySelector("#session-sidebar").getBoundingClientRect().width - 180) < 1);
        const fit = await page.locator(".sidebar-header").evaluate((element) => ({ scroll: element.scrollWidth, width: element.clientWidth }));
        assert.ok(fit.scroll <= fit.width, "the bell and existing toolbar controls fit at 180px");
        await resize.press("Enter");
      }

      const second = await context.newPage();
      second.setDefaultTimeout(30_000);
      second.setDefaultNavigationTimeout(120_000);
      await second.goto(`${base}/?session=${currentId}`, { waitUntil: "domcontentloaded" });
      await showSessions(second);
      await bell(second).click();
      await activityRow(second, runningId).waitFor({ state: "visible" });
      await page.bringToFront();
      running = false;
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "visible" });
      await bell(second).locator(".sidebar-activity-badge").waitFor({ state: "visible" });
      assert.match(await bell(page).getAttribute("aria-label"), /1 completed and unread/);
      await page.screenshot({ path: join(artifacts, `session-activity-${mobile ? "mobile" : "desktop"}.png`) });
      await activityRow(page, runningId).locator("a").click();
      await page.waitForURL((url) => url.searchParams.get("session") === runningId);
      await showSessions(page);
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "detached" });
      await bell(second).locator(".sidebar-activity-badge").waitFor({ state: "detached" });
      // A second tab may learn about the completion only after the first read it.
      // Let that tab reconcile its own running poll before checking the marker again.
      await second.bringToFront();
      await activityRow(second, runningId).locator(".sidebar-spin").waitFor({ state: "detached" });
      await bell(second).locator(".sidebar-activity-badge").waitFor({ state: "detached" });
      await page.bringToFront();
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "detached" });
      await activityRow(page, runningId).getByText("Read", { exact: true }).waitFor({ state: "visible" });
      assert.ok(await activityRow(page, manualId).count(), "the separate manually unread session stays visible");
      // A later run of the same session is a new completion, not a duplicate.
      await activityRow(page, currentId).locator("a").click();
      await showSessions(page);
      running = true;
      await activityRow(page, runningId).locator(".sidebar-spin").waitFor({ state: "visible" });
      running = false;
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "visible" });
      await bell(page).click();
      assert.equal(await bell(page).getAttribute("aria-pressed"), "false");
      assert.equal(await page.locator(".session-activity:visible").count(), 0);
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem("pi-web:completed-session-ids") ?? "[]").includes(id), runningId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await showSessions(page);
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "visible" });
      assert.equal(await bell(page).getAttribute("aria-pressed"), "false", "the view returns to the project tree on reload");
      await bell(page).click();
      await activityRow(page, runningId).locator("a").click();
      await showSessions(page);
      await bell(page).locator(".sidebar-activity-badge").waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      await context.tracing.stop();
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} session activity, completed badge and cross-tab read`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `session-activity-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
      await context.tracing.stop({ path: join(artifacts, `session-activity-${mobile ? "mobile" : "desktop"}-trace.zip`) }).catch(() => {});
      throw error;
    } finally {
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
}
