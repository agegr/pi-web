import assert from "node:assert/strict";
import { join } from "node:path";

// Synthetic catalog in a fresh composer: nothing is selected or prompted.
export async function checkModelSelector(page, { base, project, artifacts }) {
  const mobile = page.viewportSize().width <= 640;
  const models = Array.from({ length: 40 }, (_, i) => ({ provider: "e2e", id: `model-${i}`, name: `Model ${i}` }));
  const modelRoute = /\/api\/models(?:\?|$)/;
  await page.route(modelRoute, (route) => route.fulfill({ json: {
    models: Object.fromEntries(models.map((m) => [`${m.provider}/${m.id}`, m.name])),
    modelList: models, defaultModel: { provider: "e2e", modelId: "model-0" }, defaultThinkingLevel: "medium",
    savedDefaultThinkingLevel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {},
  } }));
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
  } finally {
    await page.evaluate(() => {
      for (const key of ["height", "offsetTop"]) delete window.visualViewport[key];
      window.visualViewport.dispatchEvent(new Event("resize"));
    }).catch(() => {});
    await page.unroute(modelRoute);
  }
}
