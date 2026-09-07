import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const undoPrompt = "E2E mistaken first prompt";
export const undoImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";

export async function checkFirstTurnUndo(page, base, id, filePath) {
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  const user = page.locator('[data-entry-id="undo-user"]');
  await user.waitFor();
  await user.hover();
  const undo = page.getByRole("button", { name: "Undo and edit", exact: true });
  const composer = page.locator("textarea").first();
  let dialogCount = 0;
  const rejectDialog = async (dialog) => { dialogCount++; await dialog.dismiss(); };
  page.on("dialog", rejectDialog);

  // Existing unsent work is not overwritten, and no destructive request is made.
  await composer.fill("keep this unsent draft");
  await user.hover();
  await undo.click();
  await page.getByText("Clear or save your current draft before undoing the first turn.", { exact: true }).waitFor();
  assert.equal(await composer.inputValue(), "keep this unsent draft");
  assert.ok((await readFile(filePath, "utf8")).includes("undo-user"));

  await composer.fill("");
  await user.hover();
  const request = page.waitForResponse((response) => response.url().endsWith(`/api/sessions/${id}/undo-first-turn`) && response.request().method() === "POST");
  await undo.click();
  assert.equal((await request).status(), 200);
  await user.waitFor({ state: "detached" });
  assert.equal(await composer.inputValue(), undoPrompt);
  await page.locator(`img[src="data:image/png;base64,${undoImage}"]`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
  const content = await readFile(filePath, "utf8");
  assert.ok(!content.includes("undo-user") && !content.includes("undo-assistant"));
  const response = await page.request.get(`${base}/api/sessions/${id}`);
  const detail = await response.json();
  assert.deepEqual(detail.context.messages, []);
  assert.equal(detail.firstTurnUndo, null);
  assert.equal(detail.sessionId, id);
  assert.equal(dialogCount, 0, "Undo must not open a browser confirmation dialog");
  page.off("dialog", rejectDialog);
  console.log("PASS: direct first-turn undo without dialogs, draft protection, image restoration, and empty same-session history");
}
