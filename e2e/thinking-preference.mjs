import assert from "node:assert/strict";
import { join } from "node:path";

const OLD = "e2e-thinking-preference";
export function seedThinkingPreference(writeSession, timestamp) {
  writeSession(OLD, [
    { type: "thinking_level_change", id: "setting", parentId: null, timestamp, thinkingLevel: "low" },
    { type: "message", id: "user", parentId: "setting", timestamp, message: { role: "user", content: "Old session keeps its own thinking" } },
    { type: "message", id: "answer", parentId: "user", timestamp, message: { role: "assistant", provider: "test", model: "reasoner", content: [{ type: "text", text: "Preference history fixture" }] } },
  ]);
  return [OLD];
}

export async function checkThinkingPreference({ page, base, project, artifacts, width }) {
  await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
  const data = {
    models: { "test:reasoner": "Test Reasoner", "test:plain": "Test Plain" },
    modelList: [{ provider: "test", id: "reasoner", name: "Test Reasoner" }, { provider: "test", id: "plain", name: "Test Plain" }],
    defaultModel: { provider: "test", modelId: "reasoner" },
    thinkingLevels: { "test:reasoner": ["off", "low", "high"], "test:plain": ["off"] },
    thinkingLevelPins: {},
  };
  let created = 0;
  await page.route(/\/api\/models(?:\?.*)?$/, (route) => route.fulfill({ json: data }));
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/agent/new") created++; });
  const control = () => page.getByRole("button", { name: "Change reasoning level", exact: true });
  const revealMobileControls = async () => {
    if (width <= 600 && !(await control().isVisible())) {
      await page.locator('button[aria-label="More controls"]:not([data-mobile-toolbar-more])').click();
    }
  };
  const fresh = async (level) => {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}&sidebar=collapsed`);
    await page.waitForFunction((expected) => document.querySelector('[aria-label="Change reasoning level"]')?.getAttribute("title") === `Change reasoning level: ${expected}`, level);
  };
  const choose = async (level) => {
    await revealMobileControls();
    await control().click();
    await page.getByRole("button", { name: new RegExp(`^${level}\\s`) }).click();
    await page.waitForFunction((expected) => localStorage.getItem("pi-thinking-level") === expected, level);
  };
  await fresh("auto");
  await choose("high");
  await fresh("high");
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[aria-label="Change reasoning level"]')?.getAttribute("title") === "Change reasoning level: high");
  await revealMobileControls();
  await page.screenshot({ path: join(artifacts, `thinking-preference-${width}.png`) });

  data.defaultModel = { provider: "test", modelId: "plain" };
  await fresh("auto");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-thinking-level")), "high");
  data.defaultModel = { provider: "test", modelId: "reasoner" };
  await fresh("high");
  await page.goto(`${base}/?session=${OLD}&sidebar=collapsed`);
  await page.getByText("Preference history fixture", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Change reasoning level"]')?.getAttribute("title") === "Change reasoning level: low");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-thinking-level")), "high");
  await fresh("high");
  await choose("auto");
  await fresh("auto");
  await choose("off");
  await fresh("off");
  assert.equal(created, 0, "Changing a preference must not create an agent session");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log(`PASS: ${width}px explicit thinking memory, refresh, old session, unsupported model, auto and off`);
}
