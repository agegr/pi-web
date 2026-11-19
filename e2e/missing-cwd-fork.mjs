// pi 1.5.2's Fork of a session whose folder is gone: the composer's "Project
// folder not found" banner offers it, the directory picker chooses where, and
// the copy opens there with the composer's draft. Nothing is sent to a model.
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Seed before the server starts: a session whose folder never existed, and the folder it moved to. */
export function createMissingCwdForkFixtures({ agentDir, sessionDir, timestamp }) {
  const gone = join(realpathSync(agentDir), "renamed-away");
  const moved = join(realpathSync(agentDir), "moved here");
  mkdirSync(moved);
  const id = "e2e-missing-cwd";
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd: gone },
    { type: "message", id: "gone-user", parentId: null, timestamp, message: { role: "user", content: "E2E session of a moved project" } },
    { type: "message", id: "gone-answer", parentId: "gone-user", timestamp, message: { role: "assistant", content: "E2E answer before the move" } },
  ];
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { id, gone, moved };
}

export async function checkMissingCwdFork({ browser, base, artifacts, fixture, api, deleteSession }) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: "en-US" });
    const errors = [];
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
    let forkedId = null;
    try {
      await page.goto(`${base}/?session=${fixture.id}`, { waitUntil: "domcontentloaded" });
      await page.getByText("E2E answer before the move", { exact: true }).waitFor();
      // The model list's load already reports the missing folder: no prompt is needed.
      const banner = page.getByRole("alert").filter({ hasText: "Project folder not found" });
      await banner.waitFor();
      assert.ok((await banner.textContent()).includes(`${fixture.gone} no longer exists`));
      const input = page.locator(".chat-input-textarea");
      await input.fill("E2E draft for the moved project");
      await page.screenshot({ path: join(artifacts, `missing-cwd-fork-${viewport.width}.png`) });

      await banner.getByRole("button", { name: "Fork into another folder…", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Select directory" });
      await picker.waitFor();
      const path = picker.locator("input").first();
      await path.fill(fixture.moved);
      const forkResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/sessions/${fixture.id}/fork` && response.request().method() === "POST");
      await picker.getByRole("button", { name: "Select this folder", exact: true }).click();
      const response = await forkResponse;
      assert.equal(response.status(), 200);
      assert.deepEqual(response.request().postDataJSON(), { cwd: fixture.moved });
      forkedId = (await response.json()).sessionId;

      await page.waitForURL((url) => url.searchParams.get("session") === forkedId);
      await picker.waitFor({ state: "detached" });
      await page.getByText("E2E answer before the move", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "E2E draft for the moved project");
      assert.equal(await page.getByRole("alert").filter({ hasText: "Project folder not found" }).count(), 0, "the copy's folder exists");
      // Another project's session, selected in the sidebar as a pick from the list would be.
      const selected = page.locator('.session-tree-main[aria-current="true"]');
      await page.waitForFunction((id) => document.querySelector('.session-tree-main[aria-current="true"]')?.getAttribute("href") === `?session=${id}`, forkedId);
      assert.equal(await selected.count(), 1);

      const sessions = (await api("/api/sessions")).sessions;
      const forked = sessions.find((session) => session.id === forkedId);
      assert.equal(forked?.cwd, fixture.moved);
      assert.ok(sessions.some((session) => session.id === fixture.id), "the source stays");
      assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
      console.log(`PASS: ${viewport.width}px a session whose folder is gone forks into another folder with its draft`);
    } finally {
      if (forkedId) await deleteSession(forkedId);
      await context.close();
    }
  }
}
