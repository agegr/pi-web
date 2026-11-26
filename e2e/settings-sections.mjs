// The downstream settings section (`docs/integrations.md`), exercised end to
// end: a page route answers for a pi extension that registered `ext:e2e`, and
// the checks list, fill, apply, refuse, poll and let the dialog open without it.
//
// The stub also works as a debugging helper: install it with
// `stubSettingsSection(page).install()` to see a section without installing a
// package.
import assert from "node:assert/strict";

export const SECTION_LABEL = "E2E service";
export const APPLY_OK = "Applied";
export const APPLY_REFUSED = "The address must be an http(s) URL";

/** Answers `app/api/settings/sections` for a section `ext:e2e`. */
export function stubSettingsSection(page) {
  const text = (en) => ({ en, "zh-CN": en, "zh-TW": en });
  const state = {
    values: { address: "http://127.0.0.1:4321", token: "stub-token", enabled: true },
    applied: [],
    phase: "idle",
  };
  const statusText = () => text(state.phase === "waiting" ? "Waiting for the hub" : "Running");
  const url = "**/api/settings/sections*";

  const handler = async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (request.method() === "POST") {
      const body = request.postDataJSON() ?? {};
      if (!/^https?:\/\//.test(String(body.values?.address))) {
        return route.fulfill({ status: 400, json: { error: APPLY_REFUSED } });
      }
      state.applied.push(body.values);
      state.values = { ...state.values, ...body.values };
      return route.fulfill({ json: { ok: true } });
    }
    if (parsed.searchParams.get("status") !== null) {
      return route.fulfill({ json: { status: { state: state.phase === "waiting" ? "warn" : "ok", text: statusText() } } });
    }
    if (parsed.searchParams.get("id") !== null) {
      return route.fulfill({ json: { values: state.values, status: { state: "ok", text: statusText() } } });
    }
    return route.fulfill({
      json: {
        ready: true,
        sections: [{
          id: "ext:e2e",
          label: text(SECTION_LABEL),
          icon: "sync",
          fields: [
            { kind: "readonly", label: text("Embedded server"), value: "http://127.0.0.1:30141", mono: true },
            { kind: "text", key: "address", label: text("Address"), placeholder: "http://127.0.0.1:4321" },
            { kind: "password", key: "token", label: text("Token") },
            { kind: "switch", key: "enabled", label: text("Enabled") },
          ],
          notes: [text("Registered by a stubbed extension.")],
        }],
      },
    });
  };

  return { state, install: () => page.route(url, handler), remove: () => page.unroute(url) };
}

async function openSettings(page) {
  // A phone has the sidebar closed; the Settings button lives in it.
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const button = page.getByRole("button", { name: "Settings", exact: true });
  // A click before the page hydrated does nothing, and this check reloads often.
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await dialog.isVisible().catch(() => false)) return dialog;
    await button.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await dialog.waitFor({ timeout: 10_000 });
  return dialog;
}

async function closeSettings(page) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" });
}

export async function checkSettingsSections(page, { base }) {
  const tabs = page.locator(".settings-section-tabs");
  const sectionTab = tabs.getByRole("button", { name: SECTION_LABEL, exact: true });
  // Visited sections stay mounted, so a field is looked up in the one on screen.
  const shown = () => page.locator(".settings-section-host:not([hidden])");

  // 1. With no extension the dialog lists the built-in sections only.
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await tabs.getByRole("button", { name: "MCP", exact: true }).waitFor();
  assert.equal(await sectionTab.count(), 0);
  await closeSettings(page);

  // 2. With one registered: appended last, filled from read(), applied through
  //    the route, refused with the extension's own message, status polled.
  const stub = stubSettingsSection(page);
  await stub.install();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await sectionTab.waitFor();
  const labels = (await tabs.getByRole("button").allInnerTexts()).map((label) => label.trim());
  assert.equal(labels.at(-1), SECTION_LABEL, "A section is appended, never slotted between built-ins");
  await sectionTab.click();

  const section = shown();
  const address = section.getByLabel("Address", { exact: true });
  await address.waitFor();
  assert.equal(await address.inputValue(), "http://127.0.0.1:4321", "The values come from the extension's read()");
  assert.equal(await section.getByLabel("Token", { exact: true }).getAttribute("type"), "password");
  assert.equal(await section.getByRole("switch", { name: "Enabled", exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await section.getByText("http://127.0.0.1:30141", { exact: true }).count(), 1, "A readonly field shows its fact");
  assert.equal(await section.getByText("Running", { exact: true }).count(), 1, "The status line is the extension's word");
  assert.equal(await section.getByText("Registered by a stubbed extension.", { exact: true }).count(), 1);

  // The secret can be revealed without changing the value.
  await section.getByRole("button", { name: "Show", exact: true }).click();
  assert.equal(await section.getByLabel("Token", { exact: true }).getAttribute("type"), "text");
  assert.equal(await section.getByLabel("Token", { exact: true }).inputValue(), "stub-token");
  await section.getByRole("button", { name: "Hide", exact: true }).click();

  // Apply sends the declared fields only.
  await address.fill("http://127.0.0.1:5321");
  await section.getByRole("switch", { name: "Enabled", exact: true }).click();
  await section.getByRole("button", { name: "Apply", exact: true }).click();
  await section.getByText(APPLY_OK, { exact: true }).waitFor();
  assert.deepEqual(stub.state.applied, [{ address: "http://127.0.0.1:5321", token: "stub-token", enabled: false }]);

  // A refusal is the extension's message, and the fields stay as typed.
  await address.fill("nope");
  await section.getByRole("button", { name: "Apply", exact: true }).click();
  const alert = section.locator(".settings-general-error");
  await alert.waitFor();
  assert.equal(await alert.innerText(), APPLY_REFUSED);
  assert.equal(await address.inputValue(), "nope");

  // The stub answers from this process, so its own state moves the status line.
  stub.state.phase = "waiting";
  await section.getByText("Waiting for the hub", { exact: true }).waitFor({ timeout: 6000 });

  // 3. A phone opens on the sections, with the extension's among them.
  await closeSettings(page);
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 500, height: 800 });
  await page.waitForTimeout(300);
  await openSettings(page);
  const home = page.locator(".settings-phone-home");
  await home.getByRole("button", { name: new RegExp(`^${SECTION_LABEL}`) }).waitFor();
  await home.getByRole("button", { name: new RegExp(`^${SECTION_LABEL}`) }).click();
  await shown().getByLabel("Address", { exact: true }).waitFor();
  await closeSettings(page);
  if (desktop) await page.setViewportSize(desktop);

  // 4. Once the extension is gone the dialog is back to the built-ins.
  await stub.remove();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await tabs.getByRole("button", { name: "MCP", exact: true }).waitFor();
  assert.equal(await sectionTab.count(), 0);
  await closeSettings(page);
}
