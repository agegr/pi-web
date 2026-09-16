// Run against an existing dev server: node e2e/themes.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = fileURLToPath(new URL("../test-results/themes/", import.meta.url));
const themes = ["light", "dark", "mist", "rose", "pine", "auto"];
const labels = ["Light", "Dark", "Mist", "Rose", "Pine", "System"];
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();

function contrast(a, b) {
  const luminance = (hex) => {
    const digits = hex.length === 4 ? [...hex.slice(1)].map((digit) => digit + digit).join("") : hex.slice(1);
    const channels = digits.match(/../g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US", colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep the check independent of the user's session catalogue.
    await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => route.fulfill({ json: { sessions: [] } }));
    await page.goto(base);
    await page.getByText("No sessions found", { exact: true }).waitFor({ state: "attached" });
    const openSettings = async () => {
      const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (width <= 640) await sidebar.waitFor();
      if (await sidebar.isVisible()) await sidebar.click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    };
    const expectTheme = async (theme) => {
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), theme === "dark" || theme === "pine");
      assert.equal(await page.locator("html").evaluate((root) => getComputedStyle(root).colorScheme), theme === "dark" || theme === "pine" ? "dark" : "light");
    };
    await openSettings();
    for (const [index, theme] of themes.entries()) {
      const radio = page.getByRole("radio", { name: labels[index], exact: true });
      await radio.locator("..").click();
      await expectTheme(theme === "auto" ? "light" : theme);
      assert.equal(await radio.isChecked(), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), theme);
      const colors = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root);
        return Object.fromEntries(["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg", "text", "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast"].map((key) => [key, style.getPropertyValue(`--${key}`).trim()]));
      });
      for (const foreground of ["text", "text-muted", "text-dim", "accent"]) {
        for (const background of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"]) {
          assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${theme}: ${foreground} on ${background} must meet WCAG AA`);
        }
      }
      for (const background of ["accent", "accent-hover"]) {
        assert.ok(contrast(colors["accent-contrast"], colors[background]) >= 4.5, `${theme}: button contrast`);
      }
      assert.equal(await page.locator(".settings-theme-option").evaluateAll((options) => options.every((option) => {
        const label = option.querySelector(".settings-theme-option-label");
        const box = option.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return option.scrollWidth <= option.clientWidth && text.right <= box.right && text.bottom <= box.bottom;
      })), true, `Theme labels must fit at ${width}px`);
      await page.screenshot({ path: `${artifacts}/${theme}-${width}.png`, animations: "disabled" });
      await page.reload();
      await expectTheme(theme === "auto" ? "light" : theme);
      await openSettings();
      assert.equal(await radio.isChecked(), true, "Selection must survive refresh");
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme("dark");
    await page.getByRole("radio", { name: "Pine", exact: true }).locator("..").click();
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme("pine");
    const light = page.getByRole("radio", { name: "Light", exact: true });
    await light.focus();
    await light.press("ArrowRight");
    await expectTheme("dark");
    assert.equal(await page.getByRole("radio", { name: "Dark", exact: true }).isChecked(), true);
    await page.keyboard.press("Escape");
    await page.reload();
    await expectTheme("dark");
    await page.getByText("No sessions found", { exact: true }).waitFor({ state: "attached" });
    const themeButton = page.getByRole("button", { name: /^Theme:/ });
    const menu = page.getByRole("menu", { name: "Appearance", exact: true });
    const showToolbar = async () => {
      if (width > 640) return;
      const more = page.locator("[data-mobile-toolbar-more]");
      if (await more.getAttribute("aria-expanded") !== "true") await more.click();
    };
    const openThemeMenu = async () => {
      await showToolbar();
      await themeButton.click();
      await menu.waitFor();
    };
    for (const [index, theme] of themes.entries()) {
      const before = await page.evaluate(() => localStorage.getItem("pi-theme"));
      await openThemeMenu();
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), before, "Opening the menu must not switch themes");
      assert.equal(await themeButton.getAttribute("aria-expanded"), "true");
      assert.deepEqual(await menu.getByRole("menuitemradio").allTextContents(), labels);
      assert.equal(await menu.getByRole("menuitemradio", { checked: true }).count(), 1);
      assert.equal(await menu.locator("svg").count(), 6);
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "Menu must fit the viewport");
      await menu.getByRole("menuitemradio", { name: labels[index], exact: true }).click();
      await expectTheme(theme === "auto" ? "light" : theme);
      await menu.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), theme);
      assert.equal(await themeButton.evaluate((button) => button === document.activeElement), true);
    }
    await openThemeMenu();
    assert.equal(await menu.getByRole("menuitemradio", { name: "System", exact: true }).evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expectTheme("dark");
    await openThemeMenu();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expectTheme("pine");
    await openThemeMenu();
    await page.screenshot({ path: `${artifacts}/menu-${width}.png`, animations: "disabled" });
    await page.evaluate(() => {
      window.themeEscapeReachedWindow = false;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") window.themeEscapeReachedWindow = true;
      });
    });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.themeEscapeReachedWindow), false, "Escape must not reach the global agent-abort shortcut");
    assert.equal(await themeButton.evaluate((button) => button === document.activeElement), true);
    await openThemeMenu();
    await page.mouse.click(width - 10, 850);
    await menu.waitFor({ state: "detached" });
    await openThemeMenu();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    await menu.waitFor({ state: "detached" });

    // Both selectors share positioning, dismissal, and focus handling.
    await showToolbar();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    const languageMenu = page.getByRole("menu", { name: "Language", exact: true });
    await languageMenu.waitFor();
    await page.keyboard.press("Escape");
    await languageMenu.waitFor({ state: "detached" });
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await openThemeMenu();
      await menu.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
      await expectTheme("dark");
      await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running"));
      await page.reload();
      await expectTheme("dark");
      for (const key of ["bg", "bg-panel", "bg-hover", "bg-selected", "border", "text", "text-muted", "text-dim", "user-bg", "tool-bg"]) {
        const hex = await page.locator("html").evaluate((root, token) => getComputedStyle(root).getPropertyValue(`--${token}`).trim(), key);
        const channels = hex.slice(1).match(hex.length === 4 ? /./g : /../g);
        assert.equal(new Set(channels).size, 1, `Dark ${key} must remain neutral gray`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: palettes, contrast, persistence, system preference, menu selection, keyboard navigation, dismissal, icons`);
    await context.close();
  }
} finally {
  await browser.close();
}
