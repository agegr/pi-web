import assert from "node:assert/strict";
import { join } from "node:path";

// Synthetic catalog in a fresh composer: nothing is selected or prompted.
export async function checkModelSelector(page, { base, project, artifacts }) {
  const mobile = page.viewportSize().width <= 640;
  const models = Array.from({ length: 40 }, (_, i) => ({ provider: "e2e", id: `model-${i}`, name: `Model ${i}` }));
  const modelRoute = /\/api\/models(?:\?|$)/;
  const body = (modelList, isScoped = false) => ({
    models: Object.fromEntries(modelList.map((m) => [`${m.provider}:${m.id}`, m.name])),
    modelList, defaultModel: { provider: "e2e", modelId: "model-0" }, defaultThinkingLevel: "medium",
    savedDefaultThinkingLevel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {}, isScoped,
  });
  await page.route(modelRoute, (route) => route.fulfill({ json: body(models) }));
  const trigger = page.locator(".model-selector.is-toolbar > button");
  const filter = page.getByRole("textbox", { name: "Filter models…", exact: true });
  // A simulated keyboard: the visual viewport shrinks (and may pan) while the
  // layout viewport, and with it fixed coordinates, keeps its full height.
  const setViewport = (next, notify = true) => page.evaluate(({ next, notify }) => {
    const viewport = window.visualViewport;
    for (const [key, value] of Object.entries(next)) Object.defineProperty(viewport, key, { configurable: true, get: () => value });
    if (notify) viewport.dispatchEvent(new Event("resize"));
  }, { next, notify });
  const assertVisibleAndFocused = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector('[role="listbox"]');
      const input = panel?.querySelector("input");
      if (!input?.getClientRects().length || document.activeElement !== input || input !== window.__modelFilter) return false;
      const p = panel.getBoundingClientRect();
      const v = window.visualViewport;
      return p.top >= v.offsetTop && p.bottom <= v.offsetTop + v.height;
    }, null, { timeout: 5000 });
    assert.equal(await filter.inputValue(), "Model 1");
  };

  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: "domcontentloaded" });
    await trigger.filter({ hasText: "Model 0" }).waitFor();
    await trigger.click();
    await filter.click();
    await filter.fill("Model 1");
    await filter.evaluate((input) => { window.__modelFilter = input; });
    await assertVisibleAndFocused();
    if (mobile) {
      // The keyboard hides the controls row, but not while its picker is open (#1271).
      await setViewport({ height: 450 });
      await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true");
      await assertVisibleAndFocused();
      await setViewport({ height: 340, offsetTop: 70 });
      await assertVisibleAndFocused();
      // WebKit/IME can settle a new height without a viewport event.
      await setViewport({ height: 280, offsetTop: 0 }, false);
      await filter.dispatchEvent("compositionupdate", { data: "x" });
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--app-viewport-height") === "280px");
      await assertVisibleAndFocused();
      if (artifacts) await page.screenshot({ path: join(artifacts, "model-selector-keyboard-390.png") });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    console.log(`PASS: ${page.viewportSize().width}px model picker filter stays visible${mobile ? " above the keyboard" : ""}`);

    // The composer's `/model` in a list too short for a filter field: `/model <text>`
    // shows the field with the text, and it stays while the text is cleared. A bare
    // `/model` leaves the focus in the composer, or on the page at 640px or narrower
    // (blurred for a phone keyboard): Esc closes the picker either way, as it closes
    // the reasoning menu `/thinking` opens (inside More there, which closes with it).
    await page.unroute(modelRoute);
    await page.route(modelRoute, (route) => route.fulfill({ json: body(models.slice(0, 3)) }));
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: "domcontentloaded" });
    await trigger.filter({ hasText: "Model 0" }).waitFor();
    const composer = page.locator("textarea.chat-input-textarea").first();
    const send = mobile ? "Control+Enter" : "Enter";
    await composer.fill("/model model 2");
    await composer.press(send);
    await filter.waitFor();
    assert.equal(await filter.inputValue(), "model 2");
    assert.equal(await page.getByRole("listbox").getByRole("option").count(), 1);
    await filter.fill("");
    assert.equal(await filter.count(), 1, "the field stays once its text is cleared");
    assert.equal(await page.getByRole("listbox").getByRole("option").count(), 3);
    await filter.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    const focused = () => page.evaluate(() => document.activeElement?.tagName);
    await composer.fill("/model");
    await composer.press(send);
    await page.getByRole("listbox").waitFor();
    assert.equal(await filter.count(), 0);
    assert.equal(await focused(), mobile ? "BODY" : "TEXTAREA");
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    const reasoningMenu = page.getByText("Use pi default", { exact: true });
    const more = page.locator('.chat-input-shell button[aria-label="More controls"]');
    await composer.fill("/thinking");
    await composer.press(send);
    await reasoningMenu.waitFor();
    assert.equal(await focused(), mobile ? "BODY" : "TEXTAREA");
    if (mobile) assert.equal(await more.getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    await reasoningMenu.waitFor({ state: "detached" });
    if (mobile) assert.equal(await more.getAttribute("aria-expanded"), "false");
    console.log(`PASS: ${page.viewportSize().width}px /model opens a short list's picker filtered, Esc closes a bare /model's picker and /thinking's menu`);

    // An active enabledModels scope: pi's /model "scoped | all" row, the full list fetched on demand,
    // no default star outside the scope.
    await page.unroute(modelRoute);
    const allRequests = [];
    await page.route(modelRoute, (route) => {
      const all = new URL(route.request().url()).searchParams.get("scope") === "all";
      if (all) allRequests.push(route.request().url());
      route.fulfill({ json: all ? body([...models.slice(0, 2), { provider: "other", id: "x-1", name: "Other X" }]) : body(models.slice(0, 2), true) });
    });
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: "domcontentloaded" });
    await trigger.filter({ hasText: "Model 0" }).waitFor();
    await trigger.click();
    const scopeButton = (name) => page.getByRole("listbox").getByRole("button", { name, exact: true });
    const other = page.getByRole("option", { name: "Other X" });
    assert.equal(await scopeButton("scoped").getAttribute("aria-pressed"), "true");
    assert.equal(await other.count(), 0);
    assert.equal(allRequests.length, 0, "the full list loads only on switching to all");
    if (mobile) await scopeButton("all").click();
    else await filter.press("Tab");
    await other.waitFor();
    assert.equal(await scopeButton("all").getAttribute("aria-pressed"), "true");
    assert.equal(allRequests.length, 1);
    const saveStar = (name) => page.getByRole("option", { name }).locator("..").getByRole("button", { name: "Use and save as default for new chats" });
    assert.equal(await saveStar("Model 1").count(), 1);
    assert.equal(await saveStar("Other X").count(), 0);
    if (!mobile) {
      await filter.press("Tab");
      await other.waitFor({ state: "detached" });
      await filter.press("Tab");
    }
    await other.click();
    await trigger.filter({ hasText: "Other X" }).waitFor();
    console.log(`PASS: ${page.viewportSize().width}px model picker switches to all models outside enabledModels`);
  } finally {
    await page.evaluate(() => {
      for (const key of ["height", "offsetTop"]) delete window.visualViewport[key];
      window.visualViewport.dispatchEvent(new Event("resize"));
    }).catch(() => {});
    await page.unroute(modelRoute);
  }
}
