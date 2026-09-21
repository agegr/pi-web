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
 * Opens Settings → Models on the seeded provider. The sidebar footer sits under
 * the Next.js dev overlay in `dev` mode, and a cold Turbopack compile can deliver
 * a click before hydration, so retry until the provider row is really there.
 */
async function openModelsPanel(page, providerName) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  const modelsButton = page.getByRole("button", { name: "Models", exact: true });
  const providerRow = page.getByText(providerName, { exact: true }).first();
  await modelsButton.waitFor();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await modelsButton.click({ timeout: 2_000 }).catch(() => {});
    if (await providerRow.isVisible().catch(() => false)) return;
  }
  throw new Error(`Models panel did not open on ${providerName}`);
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

export async function checkModelsSync(page, { agentDir, base, artifacts }) {
  const upstream = await startUpstreamFixture();
  try {
    const modelsPath = writeModelsConfig(agentDir, upstream.baseUrl);

    // Reload so the modal reads the seeded models.json rather than an earlier one.
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await runSync(page, { modelsPath, expectTick: true });
    assert.deepEqual(upstream.requests, ["/v1/models"], "discovery must call the upstream model list once");
    await page.screenshot({ path: join(artifacts, "models-sync.png") });

    // Second pass: the stale id survives unless removal is explicitly ticked.
    writeModelsConfig(agentDir, upstream.baseUrl);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await runSync(page, { modelsPath, expectTick: false });
  } finally {
    await upstream.close();
  }
}
