import assert from "node:assert/strict";

// Every model test and catalog request is fulfilled in the browser: no provider calls.
export async function checkModelBaseUrl(page, screenshotPath) {
  const config = { providers: { relay: {
    baseUrl: "https://provider.invalid", api: "anthropic-messages",
    models: [
      { id: "endpoint-fixture", api: "openai-responses", baseUrl: "https://model.invalid/v1" },
      { id: "untouched-fixture", baseUrl: "https://sibling.invalid/v1", headers: { "x-keep": "yes" } },
    ],
  } } };
  const tests = [];
  const catalogs = [];
  let saved;
  let releaseOldTest;
  let markOldTestHeld;
  const oldTestHeld = new Promise((resolve) => { markOldTestHeld = resolve; });
  let holdTest = false;
  const configRoute = "**/api/models-config";
  const testRoute = "**/api/models-config/test";
  const catalogRoute = "**/api/models-config/catalog?*";
  await page.route(configRoute, (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: config });
  });
  await page.route(testRoute, async (route) => {
    tests.push(route.request().postDataJSON());
    const held = holdTest;
    if (held) await new Promise((resolve) => { releaseOldTest = resolve; markOldTestHeld(); });
    await route.fulfill({ json: { ok: true, status: 200, responseText: held ? "STALE-OK" : "CURRENT-OK" } });
  });
  await page.route(catalogRoute, (route) => {
    catalogs.push(new URL(route.request().url()).searchParams.get("baseUrl"));
    return route.fulfill({ json: { recommendation: {
      preset: {}, price: { status: "unreliable", reason: "no-exact-match" },
    } } });
  });
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    const section = settings.getByRole("combobox", { name: "Settings", exact: true });
    if (await section.isVisible()) await section.selectOption("models");
    else await settings.getByRole("button", { name: "Models", exact: true }).click();
    await settings.locator(".config-sidebar-item").filter({ hasText: /^endpoint-fixture$/ }).click();
    await settings.getByRole("button", { name: /Advanced settings/ }).click();
    const url = settings.locator("#model-advanced-settings .config-field-label")
      .filter({ hasText: /^Base URL override$/ }).locator("..").locator("input");
    assert.equal(await url.inputValue(), "https://model.invalid/v1", "Hand-edited overrides must be visible");
    assert.equal(await url.getAttribute("placeholder"), "https://provider.invalid");

    await url.fill(" https://override.invalid/custom/ ");
    assert.equal(await url.inputValue(), "https://override.invalid/custom/", "Trim whitespace but never add or remove /v1 or trailing slashes");
    const testButton = () => settings.getByRole("button", { name: "Test", exact: true });
    let response = page.waitForResponse((reply) => reply.url().endsWith("/api/models-config/test"));
    await testButton().click();
    await response;
    await settings.getByText(/Connected.*CURRENT-OK/).waitFor();
    assert.equal(tests[0].model.baseUrl, "https://override.invalid/custom/");
    assert.equal(tests[0].provider.baseUrl, "https://provider.invalid");

    // A completed result and a result still in flight both belong to the old draft.
    await url.fill("https://override.invalid");
    await testButton().waitFor({ state: "visible" });
    assert.equal(tests.length, 1, "Editing must not automatically call a model");
    holdTest = true;
    const oldResponse = page.waitForResponse((reply) => reply.url().endsWith("/api/models-config/test") && reply.request().postDataJSON().model.baseUrl === "https://override.invalid");
    const oldRequest = page.waitForRequest((request) => request.url().endsWith("/api/models-config/test"));
    await testButton().click();
    await oldRequest;
    await oldTestHeld;
    await url.fill("https://override.invalid/v1");
    holdTest = false;
    response = page.waitForResponse((reply) => reply.url().endsWith("/api/models-config/test"));
    await testButton().click();
    await response;
    await settings.getByText(/Connected.*CURRENT-OK/).waitFor();
    releaseOldTest();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await settings.getByText(/STALE-OK/).count(), 0, "A late result cannot validate a different URL");

    const fillCatalog = async () => {
      const reply = page.waitForResponse((result) => result.url().includes("/api/models-config/catalog?"));
      await settings.getByRole("button", { name: "Fill model details", exact: true }).click();
      await reply;
    };
    await fillCatalog();
    assert.equal(catalogs.at(-1), "https://override.invalid/v1");
    const save = async () => {
      const reply = page.waitForResponse((result) => result.url().endsWith("/api/models-config") && result.request().method() === "PUT");
      await settings.getByRole("button", { name: "Save", exact: true }).click();
      await reply;
    };
    await save();
    assert.equal(saved.providers.relay.models[0].baseUrl, "https://override.invalid/v1");
    assert.equal(saved.providers.relay.api, "anthropic-messages");
    assert.equal(saved.providers.relay.baseUrl, "https://provider.invalid");
    assert.deepEqual(saved.providers.relay.models[1], config.providers.relay.models[1]);
    await url.scrollIntoViewIfNeeded();
    const bounds = await url.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width,
      "The model URL field must fit desktop and phone viewports");
    if (screenshotPath) await page.screenshot({ path: screenshotPath });

    await url.fill("");
    await fillCatalog();
    assert.equal(catalogs.at(-1), "https://provider.invalid", "Clearing restores the provider's effective endpoint");
    await save();
    assert.equal(Object.hasOwn(saved.providers.relay.models[0], "baseUrl"), false);
    assert.equal(saved.providers.relay.models[0].api, "openai-responses");
    assert.deepEqual(saved.providers.relay.models[1], config.providers.relay.models[1]);
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    console.log("PASS: model endpoint editing, inheritance, Save, effective catalog URL and stale test suppression");
  } finally {
    releaseOldTest?.();
    await page.unroute(configRoute);
    await page.unroute(testRoute);
    await page.unroute(catalogRoute);
  }
}
