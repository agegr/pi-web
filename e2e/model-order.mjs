import assert from "node:assert/strict";

export async function checkModelOrder(page) {
  const initial = { providers: {
    "order-relay": { baseUrl: "https://example.invalid/v1", models: [
      { id: "z-id", name: "Zulu", contextWindow: 123456 },
      { id: "a-id", name: "alpha" },
      { id: "ten-id", name: "Model 10" },
      { id: "two-id", name: "Model 2" },
    ] },
    "order-other": { baseUrl: "https://example.invalid/v1", models: [{ id: "keep-last" }] },
  } };
  const enabledView = {
    allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 5, availableTotal: 5,
    scope: "global", settingsPath: "models-fixture/settings.json", editable: true, providers: [],
  };
  let saved;
  let writes = 0;
  let resync;
  const routes = ["**/api/models-config", "**/api/auth/providers", "**/api/models/enabled*"];
  await page.route(routes[0], (route) => {
    if (route.request().method() === "PUT") {
      writes++;
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: saved ?? initial });
  });
  await page.route(routes[1], (route) => route.fulfill({ json: {
    oauthProviders: [], apiKeyProviders: [], providerNames: {},
  } }));
  await page.route(routes[2], (route) => {
    if (route.request().method() === "PUT") resync = route.request().postDataJSON();
    return route.fulfill({ json: enabledView });
  });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const modelRows = settings.locator(".models-sidebar-indented-item:not(.models-sidebar-add-item)");
  const row = (label) => modelRows.filter({ hasText: label });
  const drag = async (label, target, after) => {
    const box = await row(target).boundingBox();
    await row(label).dragTo(row(target), { targetPosition: { x: 20, y: after ? box.height - 4 : 4 } });
  };
  const labels = () => modelRows.allTextContents();
  const field = (label) => settings.locator(".config-field-label").filter({ hasText: label }).locator("..").locator("input");
  const phone = page.viewportSize().width <= 640;
  const backToList = async () => {
    if (!phone) return;
    await settings.getByRole("button", { name: "Back to Models", exact: true }).click();
    await settings.locator(".config-split-view[data-pane='list']").waitFor({ state: "visible" });
  };
  const checkSelectedModel = async () => {
    if (phone) await row("Model 10").click();
    assert.equal(await field(/^ID \*$/).inputValue(), "ten-id");
    await backToList();
  };
  try {
    const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const section = settings.getByRole("combobox", { name: "Settings", exact: true });
    if (await section.isVisible()) await section.selectOption("models");
    else await settings.getByRole("button", { name: "Models", exact: true }).click();
    await modelRows.first().waitFor();
    assert.deepEqual(await labels(), ["Zulu", "alpha", "Model 10", "Model 2", "keep-last"]);
    assert.equal(await settings.getByRole("button", { name: "Sort models by shown name (A–Z)", exact: true }).last().isDisabled(), true);
    await drag("alpha", "Zulu", false);
    assert.deepEqual(await labels(), ["alpha", "Zulu", "Model 10", "Model 2", "keep-last"]);
    await row("Model 10").click();
    await backToList();
    await drag("Zulu", "Model 2", true);
    assert.deepEqual(await labels(), ["alpha", "Model 10", "Model 2", "Zulu", "keep-last"]);
    await checkSelectedModel();
    // A model never lands in another provider.
    await drag("Zulu", "keep-last", false);
    assert.deepEqual(await labels(), ["alpha", "Model 10", "Model 2", "Zulu", "keep-last"]);

    const zulu = row("Zulu");
    await zulu.focus();
    assert.equal(await zulu.getAttribute("aria-keyshortcuts"), "Alt+ArrowUp Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowDown");
    assert.deepEqual(await labels(), ["alpha", "Model 10", "Model 2", "Zulu", "keep-last"]);
    await page.keyboard.press("Alt+ArrowUp");
    assert.deepEqual(await labels(), ["alpha", "Model 10", "Zulu", "Model 2", "keep-last"]);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Zulu");
    assert.equal(writes, 0);

    await settings.getByRole("button", { name: "Sort models by shown name (A–Z)", exact: true }).first().click();
    assert.deepEqual(await labels(), ["alpha", "Model 2", "Model 10", "Zulu", "keep-last"]);
    await checkSelectedModel();
    assert.equal(writes, 0);
    await zulu.click();
    const zuluRow = await zulu.elementHandle();
    await field(/^ID \*$/).fill("z-renamed");
    // Editing the model keeps its sidebar row mounted.
    assert.equal(await zuluRow.evaluate((node) => node.isConnected), true);
    await backToList();
    await settings.locator(".models-sidebar-add-item").first().click();
    await field(/^ID \*$/).fill("new-id");
    await field(/^Name$/).fill("Aardvark");
    assert.deepEqual(await labels(), ["alpha", "Model 2", "Model 10", "Zulu", "Aardvark", "keep-last"]);

    const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/models-config") && response.request().method() === "PUT");
    const resyncResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/models/enabled" && response.request().method() === "PUT");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await Promise.all([saveResponse, resyncResponse]);
    assert.equal(writes, 1);
    assert.deepEqual(saved.providers["order-relay"].models.map((model) => model.id), ["a-id", "two-id", "ten-id", "z-renamed", "new-id"]);
    assert.equal(saved.providers["order-relay"].models.find((model) => model.id === "z-renamed").contextWindow, 123456);
    assert.deepEqual(saved.providers["order-other"], initial.providers["order-other"]);
    assert.deepEqual(resync.modelRenames, [{ from: "order-relay/z-id", to: "order-relay/z-renamed" }]);
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    console.log("PASS: model drag and Alt+arrow moves, keyboard focus, one-shot A–Z, append order and rename-safe Save");
  } finally {
    for (const route of routes) await page.unroute(route);
  }
}
