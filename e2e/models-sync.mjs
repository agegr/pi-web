import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const TARGET_PROVIDER = "e2e-sync-target";
const OTHER_PROVIDER = "e2e-sync-other";

const upstreamModelList = {
  object: "list",
  data: [
    { id: "e2e-model-alpha", object: "model" },
    { id: "e2e-model-beta", object: "model", name: "E2E Model Beta" },
  ],
};

/** Minimal OpenAI-compatible upstream so the check never needs real credentials. */
async function startUpstreamFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(upstreamModelList));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function readProviders(modelsPath) {
  return JSON.parse(readFileSync(modelsPath, "utf8")).providers;
}

function writeModelsConfig(agentDir, baseUrl) {
  const modelsPath = join(agentDir, "models.json");
  writeFileSync(modelsPath, `${JSON.stringify({
    providers: {
      [TARGET_PROVIDER]: {
        baseUrl,
        api: "openai-completions",
        models: [
          { id: "e2e-model-alpha", name: "E2E Alpha" },
          { id: "e2e-retired", name: "E2E Retired" },
        ],
      },
      [OTHER_PROVIDER]: {
        baseUrl,
        api: "openai-completions",
        models: [{ id: "e2e-untouched" }],
      },
    },
  }, null, 2)}\n`, "utf8");
  return modelsPath;
}

/**
 * Opens the Models panel on the seeded provider.
 *
 * Two routes, because layout and hydration both bite here: the sidebar footer's
 * own "Models" button (the user path) first, then Settings → section tab as a
 * fallback. The whole attempt is retried until the provider row is really
 * rendered, since a cold Turbopack compile can swallow the first clicks.
 */
async function openModelsPanel(page, providerName) {
  const dialog = page.getByRole("dialog");
  const providerRow = () => dialog.getByText(providerName, { exact: true }).first();
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  const deadline = Date.now() + 90_000;
  let lastError;

  const ensureSidebar = async () => {
    if (await showSidebar.isVisible().catch(() => false)) await showSidebar.click({ timeout: 2_000 });
  };

  while (Date.now() < deadline) {
    await ensureSidebar();
    try {
      await page.getByRole("button", { name: "Models", exact: true }).click({ timeout: 3_000 });
      await providerRow().waitFor({ timeout: 4_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press("Escape").catch(() => {});
    }
    try {
      await ensureSidebar();
      await page.getByRole("button", { name: "Settings", exact: true }).click({ timeout: 3_000 });
      await dialog.waitFor({ timeout: 5_000 });
      const tab = dialog.locator("button.settings-section-tab", { hasText: "Models" });
      if (await tab.first().isVisible().catch(() => false)) await tab.first().click({ timeout: 3_000 });
      else await dialog.getByRole("combobox").selectOption("models");
      await providerRow().waitFor({ timeout: 4_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  throw new Error(`Models panel did not open on ${providerName}: ${lastError?.message ?? "unknown"}`);
}

async function runSync(page, { modelsPath, expectTick }) {
  await openModelsPanel(page, TARGET_PROVIDER);
  await page.getByText(TARGET_PROVIDER, { exact: true }).first().click();
  await page.getByRole("button", { name: /Import models/ }).click();

  const summary = page.getByText(/Upstream: \d+ models/);
  await summary.waitFor();
  assert.equal(
    (await summary.innerText()).trim(),
    "Upstream: 2 models · 1 to add · 1 no longer offered",
    "sync must report upstream additions and stale ids separately",
  );

  const staleToggle = page.getByText(/Also remove 1 models no longer offered upstream/);
  await staleToggle.waitFor();
  if (expectTick) await page.locator('input[type="checkbox"]').last().check();

  await page.getByRole("button", { name: "Sync models", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);

  const providers = readProviders(modelsPath);
  // Existing models keep their order; upstream additions append at the end.
  assert.deepEqual(
    providers[TARGET_PROVIDER].models.map((model) => model.id),
    expectTick ? ["e2e-model-alpha", "e2e-model-beta"] : ["e2e-model-alpha", "e2e-retired", "e2e-model-beta"],
    expectTick
      ? "sync must add upstream models and drop the opted-in stale id"
      : "sync must keep a stale id while the user has not opted into removal",
  );
  assert.deepEqual(
    providers[OTHER_PROVIDER].models.map((model) => model.id),
    ["e2e-untouched"],
    "sync must not touch other providers",
  );
}

export async function checkModelsSync(page, { agentDir, base, artifacts, sessionId }) {
  const upstream = await startUpstreamFixture();
  try {
    const modelsPath = writeModelsConfig(agentDir, upstream.baseUrl);

    // Load a session so the app renders the same desktop layout the other
    // checks use, and so the seeded models.json is read on a fresh page.
    const pageUrl = sessionId ? `${base}/?session=${sessionId}` : `${base}/`;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await runSync(page, { modelsPath, expectTick: true });
    assert.deepEqual(upstream.requests, ["/v1/models"], "discovery must call the upstream model list once");
    await page.screenshot({ path: join(artifacts, "models-sync.png") });

    // Second pass: the stale id survives unless removal is explicitly ticked.
    writeModelsConfig(agentDir, upstream.baseUrl);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await runSync(page, { modelsPath, expectTick: false });
  } finally {
    await upstream.close();
  }
}
