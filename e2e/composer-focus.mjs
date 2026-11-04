import assert from "node:assert/strict";

export async function checkComposerFocus(page, { base, sessionId }) {
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const input = page.locator(".chat-input-textarea");
  await input.waitFor();
  const agentUrl = `${base}/api/agent/${encodeURIComponent(sessionId)}`;
  let finishCompaction;
  const compactResult = new Promise(resolve => { finishCompaction = resolve; });
  // Hold only the compaction POST. The production slash-command handler and
  // composer still run; no model is called or session history changed.
  const intercept = async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON()?.type !== "compact") {
      await route.continue();
      return;
    }
    await compactResult;
    await route.fulfill({ json: { success: true, data: { tokensBefore: 100 } } });
  };
  await page.route(agentUrl, intercept);
  try {
    await input.fill("/compact");
    const originalInput = await input.elementHandle();
    await Promise.all([
      page.waitForRequest(request => request.url() === agentUrl
        && request.method() === "POST" && request.postDataJSON()?.type === "compact"),
      // Ctrl+Enter submits on phones too, without changing their Enter setting.
      input.press("Control+Enter"),
    ]);
    await page.waitForFunction(() => {
      const input = document.querySelector(".chat-input-textarea");
      return input?.value === "" && !input.matches(":disabled");
    });
    assert.equal(await input.evaluate(el => document.activeElement === el), true,
      "/compact must leave the caret in the enabled composer");
    // keyboard.type, not locator.fill: filling would refocus and hide the bug.
    await page.keyboard.type("next prompt");
    assert.equal(await input.inputValue(), "next prompt");
    await input.evaluate(el => el.setSelectionRange(4, 4));
    const refreshed = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/sessions/${encodeURIComponent(sessionId)}`);
    finishCompaction();
    await (await refreshed).finished();
    await page.getByRole("button", { name: "Stop compaction", exact: true }).waitFor({ state: "hidden" });
    await input.waitFor();
    assert.equal(await originalInput.evaluate(el => el.isConnected), true,
      "the history refresh must keep the original composer mounted");
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    assert.equal(await input.evaluate(el => el.selectionStart), 4);
    assert.equal(await input.inputValue(), "next prompt");
    await input.fill("");
    console.log("PASS: /compact keeps composer focus and accepts the next draft while compacting");
  } finally {
    finishCompaction();
    await page.unroute(agentUrl, intercept);
  }
}
