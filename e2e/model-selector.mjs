import assert from "node:assert/strict";
import { join } from "node:path";

// Synthetic catalog only: selecting in a fresh composer never starts an agent.
export async function checkModelSelector(page, { base, project, artifacts }) {
  const mobile = page.viewportSize().width <= 640;
  const models = Array.from({ length: 40 }, (_, i) => ({
    provider: i < 20 ? "z-first" : "a-second", id: `model-${i}`, name: `Model ${i}`,
  }));
  let defaultModel = { provider: models[0].provider, modelId: models[0].id };
  const defaults = [];
  const agentWrites = [];
  const modelRoute = /\/api\/models(?:\?|$)/;
  const profileWrites = [];
  await page.route("**/api/subagents/**", (route) => {
    if (route.request().method() !== "GET") {
      profileWrites.push(route.request().method());
      return route.abort();
    }
    return route.fulfill({ json: route.request().url().includes("/profiles")
      ? { profiles: [] } : { enabled: true, maxConcurrent: 10 } });
  });
  await page.route(modelRoute, (route) => route.fulfill({ json: {
    models: Object.fromEntries(models.map((m) => [`${m.provider}/${m.id}`, m.name])),
    modelList: models, defaultModel, defaultThinkingLevel: "medium", savedDefaultThinkingLevel: null,
    thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {},
  } }));
  await page.route("**/api/models/default", (route) => {
    const body = route.request().postDataJSON();
    defaults.push(body);
    defaultModel = { provider: body.provider, modelId: body.modelId };
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/agent/**", (route) => {
    if (route.request().method() === "POST") {
      agentWrites.push(route.request().postDataJSON());
      return route.abort();
    }
    return route.continue();
  });
  const trigger = page.locator(".model-selector.is-toolbar > button");
  const panel = page.getByRole("listbox");
  const filter = page.getByRole("textbox", { name: "Filter models…", exact: true });
  const rememberInput = () => filter.evaluate((input) => { window.__modelFilter = input; });
  const assertStableInput = async (value) => {
    assert.equal(await filter.evaluate((input) => input === window.__modelFilter && document.activeElement === input), true,
      "viewport changes must keep the same input node focused");
    assert.equal(await filter.inputValue(), value);
  };
  const setViewport = async (state, notify = true) => {
    await page.evaluate(({ next, notify }) => {
      const viewport = window.visualViewport;
      if (!window.__modelViewport) {
        window.__modelViewport = { height: viewport.height, width: viewport.width, offsetTop: viewport.offsetTop, offsetLeft: viewport.offsetLeft };
        window.__modelViewportOriginal = Object.fromEntries(Object.keys(window.__modelViewport).map((key) => [key, Object.getOwnPropertyDescriptor(viewport, key)]));
        for (const key of Object.keys(window.__modelViewport)) Object.defineProperty(viewport, key, { configurable: true, get: () => window.__modelViewport[key] });
      }
      Object.assign(window.__modelViewport, next);
      if (notify) {
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      }
    }, { next: state, notify });
  };
  const restoreViewport = () => page.evaluate(() => {
    if (!window.__modelViewportOriginal) return;
    for (const [key, descriptor] of Object.entries(window.__modelViewportOriginal)) {
      if (descriptor) Object.defineProperty(window.visualViewport, key, descriptor);
      else delete window.visualViewport[key];
    }
    delete window.__modelViewportOriginal;
    delete window.__modelViewport;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  const assertInViewport = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector('[role="listbox"]');
      const input = panel?.querySelector("input");
      if (!panel?.getClientRects().length || !input?.getClientRects().length) return false;
      const p = panel.getBoundingClientRect();
      const v = window.visualViewport;
      return p.top >= v.offsetTop + 7 && p.bottom <= v.offsetTop + v.height - 7
        && p.left >= v.offsetLeft + 7 && p.right <= v.offsetLeft + v.width - 7;
    }, null, { timeout: 5000 });
    assert.equal(await filter.evaluate((input) => {
      const r = input.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === input;
    }), true, "filter must be reachable, not under another surface");
  };

  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: "domcontentloaded" });
    await trigger.filter({ hasText: "Model 0" }).waitFor();
    await trigger.click();
    await panel.waitFor();
    assert.equal(await filter.evaluate((input) => input === document.activeElement), !mobile,
      "phones keep tap-to-filter; desktop retains autofocus");
    assert.deepEqual(await panel.getByRole("option").allTextContents(), models.map((m) => m.name), "incoming provider/model order stays intact");
    await filter.fill("Model 1");
    assert.equal(await panel.getByRole("option").count(), 11);
    await rememberInput();

    if (mobile) {
      await setViewport({ height: 450 });
      const keyboard = await (await page.waitForFunction(() => {
        if (document.documentElement.dataset.keyboardOpen !== "true") return false;
        const input = document.querySelector('[role="listbox"] input');
        return {
          controlsDisplay: getComputedStyle(document.querySelector(".chat-input-controls")).display,
          filterVisible: Boolean(input?.getClientRects().length),
        };
      })).jsonValue();
      // Read both facts in one frame: on main the hidden filter can lose
      // focus, which clears keyboard-open again on the next settle pass.
      assert.equal(keyboard.controlsDisplay, "none");
      assert.equal(keyboard.filterVisible, true, "model filter must survive the keyboard hiding composer controls (#1271)");
      await assertInViewport();
      await assertStableInput("Model 1");
      if (artifacts) await page.screenshot({ path: join(artifacts, "model-selector-keyboard-390.png") });
      await setViewport({ height: 340, width: 350, offsetTop: 70, offsetLeft: 20 });
      await assertInViewport();
      await assertStableInput("Model 1");
      // Safari/IME can settle to a new height without a viewport event. The
      // existing app-height hook rereads it after editable activity.
      await setViewport({ height: 280 }, false);
      await filter.dispatchEvent("compositionupdate", { data: "候选" });
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--app-viewport-height") === "280px");
      await assertInViewport();
      await assertStableInput("Model 1");
      // Dismiss/reopen the keyboard without unmounting or clearing the filter.
      await restoreViewport();
      await assertInViewport();
      await assertStableInput("Model 1");
      await setViewport({ height: 450 });
      await assertInViewport();
      await filter.fill("Model 17");
      await assertStableInput("Model 17");
      await panel.getByRole("option", { name: "Model 17", exact: true }).click();
      await panel.waitFor({ state: "detached" });
      await restoreViewport();
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-keyboard-open"));
      assert.match(await trigger.innerText(), /Model 17/);
    } else {
      await assertInViewport();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
    }

    await trigger.click();
    assert.equal(await filter.inputValue(), "", "selection/Escape clears the old query");
    await filter.fill("Model 2");
    const row = panel.getByRole("option", { name: "Model 2", exact: true }).locator("..");
    await row.hover();
    await row.getByRole("button", { name: "Use and save as default for new chats", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    await trigger.filter({ hasText: "Model 2" }).waitFor();
    assert.deepEqual(defaults, [{ cwd: project, provider: "z-first", modelId: "model-2" }], "the default star saves once and selects its own model");
    await trigger.click();
    await filter.fill("no such model");
    await panel.getByText("No matching models", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    await trigger.click();
    await page.mouse.click(1, 1); // Outside the viewport-clamped menu's 8px inset.
    await panel.waitFor({ state: "detached" });

    // The same selector is a field in Settings. It must remain above that
    // dialog, and Escape in the menu must not dismiss the underlying draft.
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    const section = settings.getByRole("combobox", { name: "Settings", exact: true });
    if (await section.isVisible()) await section.selectOption("agents");
    else await settings.getByRole("button", { name: "Sub-agents", exact: true }).click();
    await settings.getByRole("button", { name: "New sub-agent", exact: true }).click();
    const field = settings.getByRole("button", { name: "Model override", exact: true });
    await field.click();
    await filter.fill("Model 3");
    await rememberInput();
    if (mobile) await setViewport({ height: 450 });
    await assertInViewport();
    await assertStableInput("Model 3");
    await filter.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    assert.equal(await panel.isVisible(), true, "IME cancellation must not close the picker");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    assert.equal(await settings.isVisible(), true, "Escape closes only the picker");
    await restoreViewport();
    await field.click();
    await filter.fill("Model 31");
    await panel.getByRole("option", { name: "Model 31", exact: true }).click();
    await field.filter({ hasText: "Model 31" }).waitFor();
    await field.click();
    await panel.getByRole("option", { name: "Parent default", exact: true }).click();
    await field.filter({ hasText: "Parent default" }).waitFor();
    assert.deepEqual(profileWrites, [], "editing a field must not save the profile");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    assert.deepEqual(agentWrites, [], "selecting/filtering must not create or prompt a session");
    if (artifacts) await page.screenshot({ path: join(artifacts, `model-selector-${page.viewportSize().width}.png`) });
    console.log(`PASS: ${page.viewportSize().width}px model picker filtering, viewport, selection, default, Escape and outside click`);
  } finally {
    await restoreViewport().catch(() => {}); // A failed navigation may have no execution context.
    await page.unroute(modelRoute);
    await page.unroute("**/api/models/default");
    await page.unroute("**/api/agent/**");
    await page.unroute("**/api/subagents/**");
  }
}
