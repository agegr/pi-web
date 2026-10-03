import assert from "node:assert/strict";

// The UI must preserve omitted protocols so discovery can resolve them through
// pi's catalogue. These routes isolate the panel from credentials and upstreams.
export async function checkModelDiscovery(page) {
  const config = { providers: {
    anthropic: { models: [{ id: "claude-existing" }] },
    relay: { baseUrl: "https://example.invalid/v1", api: "openai-responses", models: [{ id: "relay-existing" }] },
  } };
  const discoveries = [];
  let saved;
  const configRoute = "**/api/models-config";
  const discoveryRoute = "**/api/models-config/discover";
  await page.route(configRoute, (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: config });
  });
  await page.route(discoveryRoute, (route) => {
    discoveries.push(route.request().postDataJSON());
    return route.fulfill({ json: {
      models: [{ id: "discovered-fixture" }], endpoint: "https://example.invalid/v1/models",
    } });
  });
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Models", exact: true }).click();
    await settings.locator(".config-sidebar-item").filter({ hasText: /^anthropic$/ }).click();
    const api = settings.locator(".config-field-label").filter({ hasText: /^API$/ }).locator("..").locator("select");
    assert.equal(await api.inputValue(), "", "A missing protocol stays unspecified in the editor");
    const discover = async () => {
      const response = page.waitForResponse((reply) => reply.url().endsWith("/api/models-config/discover"));
      await settings.getByRole("button", { name: "Import models…", exact: true }).click();
      await response;
    };
    await discover();
    assert.equal(discoveries[0].providerName, "anthropic");
    assert.equal(discoveries[0].provider.api, undefined, "Discovery must reach the catalog protocol fallback");
    assert.equal(discoveries[0].provider.baseUrl, undefined);

    await settings.locator(".config-sidebar-item").filter({ hasText: /^relay$/ }).click();
    assert.equal(await api.inputValue(), "openai-responses");
    await discover();
    assert.equal(discoveries[1].provider.api, "openai-responses", "Explicit protocols must stay authoritative");
    assert.equal(discoveries[1].provider.baseUrl, "https://example.invalid/v1");

    const saveResponse = page.waitForResponse((reply) => reply.url().endsWith("/api/models-config") && reply.request().method() === "PUT");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await saveResponse;
    assert.equal(saved.providers.anthropic.api, undefined, "Visiting a provider must not persist a guessed protocol");
    assert.equal(saved.providers.relay.api, "openai-responses");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    console.log("PASS: discovery preserves catalog protocols and explicit overrides without changing them on Save");
  } finally {
    await page.unroute(configRoute);
    await page.unroute(discoveryRoute);
  }
}
