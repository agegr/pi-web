// Run against a built server: node e2e/models-config-loading.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE || undefined,
});

try {
  const page = await browser.newPage({ locale: "en-US" });
  let releaseConfig;
  const configReady = new Promise((resolve) => { releaseConfig = resolve; });
  await page.route(/\/api\/models-config$/, async (route) => {
    if (route.request().method() === "GET") await configReady;
    await route.continue();
  });

  await page.goto(base);
  await page.getByRole("button", { name: "Models", exact: true }).first().click();
  const save = page.getByRole("button", { name: "Save", exact: true }).last();
  await save.waitFor();
  assert.equal(await save.isEnabled(), false, "Save must stay disabled until models.json loads");

  releaseConfig();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.some((button) => button.textContent?.trim() === "Save" && !button.disabled);
  });
  console.log("PASS Save is disabled until models.json has loaded");
} finally {
  await browser.close();
}
