// #1207: a project group's menu opens its fresh composer in another browser
// tab, using the same directory as + and leaving this tab's work alone.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles, showSidebarSessions } from "./sidebar.mjs";
import { filePanelFixture } from "./file-panel.mjs";

/** Seed before the server starts: a real linked worktree and an empty project. */
export function createProjectNavigationFixtures({ agentDir, sessionDir, timestamp }) {
  const root = join(realpathSync(agentDir), "project-tabs");
  const worktree = join(realpathSync(agentDir), "project-tabs-worktrees", "tab #1 & 中文");
  const empty = join(realpathSync(agentDir), "empty project");
  const hooks = join(agentDir, "empty-hooks");
  const gitConfig = join(agentDir, "empty.gitconfig");
  for (const path of [root, empty, hooks]) mkdirSync(path, { recursive: true });
  writeFileSync(gitConfig, "");
  const git = (...args) => execFileSync("git", [
    "-C", root, "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false",
    "-c", "user.name=Pi Web E2E", "-c", "user.email=pi-web-test@example.invalid", ...args,
  ], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitConfig }, timeout: 10_000, stdio: "pipe" });
  git("init", "-q");
  git("commit", "--allow-empty", "-qm", "fixture");
  git("worktree", "add", "-b", "test/project-tab", worktree);
  const note = join(worktree, "project-note.html");
  writeFileSync(note, filePanelFixture);
  const id = "e2e-project-navigation";
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd: worktree },
    { type: "message", id: "project-user", parentId: null, timestamp, message: { role: "user", content: "E2E project navigation" } },
    { type: "message", id: "project-answer", parentId: "project-user", timestamp, message: { role: "assistant", content: "E2E linked-worktree answer" } },
  ];
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { id, root, worktree, empty, note };
}

export async function checkProjectNavigation({ browser, base, artifacts, fixture, otherSessionId, api, post }) {
  const initialSessions = (await api("/api/sessions")).sessions;
  const initialIds = initialSessions.map((session) => session.id).sort();
  const current = initialSessions.find((session) => session.id === fixture.id);
  const other = initialSessions.find((session) => session.id === otherSessionId);
  assert.ok(current?.projectKey && other?.projectKey, "both projects have their server identity");
  assert.equal(current.projectRoot, fixture.root, "the linked worktree belongs to its main project");
  const empty = await post("/api/cwd/validate", { cwd: fixture.empty });
  const pin = { action: "pin-project", projectKey: empty.projectKey, root: empty.projectRoot };
  await post("/api/sessions/ui-state", { ...pin, pinned: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        locale: "en-US", hasTouch: mobile, isMobile: mobile,
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const errors = [];
      const forbidden = [];
      const forbiddenCommands = new Set(["prompt", "steer", "follow_up", "fork", "fork_branch", "clone", "new_session", "abort", "abort_bash"]);
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
        });
      });
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (!url.href.startsWith(base)) return;
        if (url.pathname === "/api/agent/new" || /^\/api\/sessions\/[^/]+\/fork$/.test(url.pathname)) {
          forbidden.push(`${request.method()} ${url.pathname}`);
        } else if (request.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(url.pathname)) {
          const type = request.postDataJSON()?.type;
          if (forbiddenCommands.has(type)) forbidden.push(type);
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const input = page.locator("textarea.chat-input-textarea");
      const group = (key) => page.locator(`[data-row-key=${JSON.stringify(`group:${key}`)}]`);
      const selected = (target) => target.locator("#session-sidebar-panel-sessions .session-tree-main[aria-current='true']");
      const showSessions = async () => {
        const show = page.getByRole("button", { name: "Show sidebar", exact: true });
        if (await show.isVisible()) await show.click();
        await showSidebarSessions(page);
      };
      const openMenu = async (key) => {
        await showSessions();
        const row = group(key);
        await row.hover();
        await row.locator("button[aria-haspopup='menu']").click();
        const menu = page.getByRole("menu");
        await menu.waitFor();
        const names = (await menu.getByRole("menuitem").allInnerTexts()).map((text) => text.split("\n")[0].trim());
        const at = names.indexOf("Open in new tab");
        assert.ok(at > 0, "the action is not the first item");
        assert.equal(names[at - 1], "Open in Files");
        return menu;
      };
      const openTab = async (key, keyboard = false) => {
        const menu = await openMenu(key);
        const opened = context.waitForEvent("page");
        if (keyboard) await page.keyboard.press("t");
        else await menu.getByRole("menuitem", { name: /^Open in new tab/ }).click();
        const tab = await opened;
        tab.setDefaultTimeout(30_000);
        await tab.waitForURL((url) => url.href !== "about:blank", { waitUntil: "domcontentloaded" });
        return tab;
      };
      const expectComposer = async (tab, cwd) => {
        await tab.locator(".new-session-hero").waitFor({ state: "visible" });
        await tab.waitForFunction((expected) => {
          const open = JSON.parse(sessionStorage.getItem("pi-web:tab-open-session") || "null");
          return open?.kind === "new" && open.cwd === expected;
        }, cwd);
        const url = new URL(tab.url());
        assert.deepEqual([...url.searchParams.entries()], [["cwd", cwd]]);
        assert.equal(url.hash, "");
        assert.equal(await selected(tab).count(), 0, "no remembered session selected");
        assert.equal(await tab.locator("textarea.chat-input-textarea").inputValue(), "");
        assert.equal(await tab.evaluate(() => window.opener), null);
      };
      try {
        // Remember another project's session, then this project's. Neither
        // memory may override the new tab's explicit cwd (including reload).
        await page.goto(`${base}/?session=${otherSessionId}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction((id) => JSON.parse(sessionStorage.getItem("pi-web:tab-open-session") || "null")?.sessionId === id, otherSessionId);
        await page.goto(`${base}/?session=${fixture.id}`, { waitUntil: "domcontentloaded" });
        await page.getByText("E2E linked-worktree answer", { exact: true }).waitFor();
        await input.fill("Keep this source-tab draft");
        await showSessions();
        const sourceUrl = page.url();
        const sourceCwd = await page.locator(".sidebar-new-button").getAttribute("title");
        let fileFrame;
        let fileInstance;
        if (!mobile) {
          await showSidebarFiles(page);
          await page.getByTitle(fixture.note.replace(/\\/g, "/"), { exact: true }).click();
          const iframe = page.locator("#file-panel iframe");
          await iframe.waitFor();
          fileFrame = await (await iframe.elementHandle()).contentFrame();
          await fileFrame.locator("#notes").fill("Keep this file preview");
          fileInstance = await fileFrame.evaluate(() => window.previewInstance);
        }
        for (const [key, cwd, label] of [
          [current.projectKey, current.cwd, "current worktree"],
          [other.projectKey, other.projectRoot, "other project"],
          [empty.projectKey, empty.cwd, "pinned project without sessions"],
        ]) {
          const expanded = await group(key).locator(".session-tree-group-toggle").getAttribute("aria-expanded");
          const tab = await openTab(key, !mobile && key === current.projectKey);
          await expectComposer(tab, cwd);
          await tab.reload({ waitUntil: "domcontentloaded" });
          await expectComposer(tab, cwd);
          await tab.close();
          await page.bringToFront();
          assert.equal(page.url(), sourceUrl);
          assert.equal(await selected(page).getAttribute("href"), `?session=${fixture.id}`);
          assert.equal(await input.inputValue(), "Keep this source-tab draft");
          assert.equal(await page.locator(".sidebar-new-button").getAttribute("title"), sourceCwd);
          assert.equal(await group(key).locator(".session-tree-group-toggle").getAttribute("aria-expanded"), expanded);
          if (!mobile) {
            assert.equal(await page.locator("#file-panel").isVisible(), true);
            assert.equal(await fileFrame.evaluate(() => window.previewInstance), fileInstance, "the file preview was not remounted");
            assert.equal(await fileFrame.locator("#notes").inputValue(), "Keep this file preview");
          }
          console.log(`PASS: ${mobile ? "mobile" : "desktop"} project Open in new tab: ${label}, reload, source context preserved`);
        }
        if (mobile) {
          // A gone directory stays an explicit failed destination; it must
          // not turn into another project/session or recreate the directory.
          rmSync(fixture.empty, { recursive: true });
          const tab = await openTab(empty.projectKey);
          await tab.getByText(`Directory does not exist: ${empty.cwd}`, { exact: true }).waitFor();
          assert.equal(new URL(tab.url()).searchParams.get("cwd"), empty.cwd);
          assert.equal(await selected(tab).count(), 0);
          await tab.close();
          console.log("PASS: an unavailable project's new tab shows the validation error, not another session");
        }
        // + still means New here, not another tab, and chooses the same worktree.
        await showSessions();
        await group(current.projectKey).hover();
        await group(current.projectKey).getByRole("button", { name: /^New session in / }).click();
        await page.locator(".new-session-hero").waitFor({ state: "visible" });
        await page.waitForURL((url) => url.searchParams.get("cwd") === current.cwd);
        assert.equal(context.pages().length, 1);
        assert.deepEqual(forbidden, [], "no session created, copied, prompted or stopped");
        assert.deepEqual((await api("/api/sessions")).sessions.map((session) => session.id).sort(), initialIds);
        assert.deepEqual(errors, []);
        console.log(`PASS: ${mobile ? "mobile" : "desktop"} project + stays in this tab; no session mutation while opening projects`);
        await context.tracing.stop();
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `project-navigation-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
        await context.tracing.stop({ path: join(artifacts, "project-navigation-trace.zip") }).catch(() => {});
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await post("/api/sessions/ui-state", { ...pin, pinned: false });
  }
}
