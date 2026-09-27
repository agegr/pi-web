import assert from "node:assert/strict";
import { join } from "node:path";

export const extensionSource = `export default function (pi) {
  pi.registerCommand("e2e-dialog", {
    handler: async (mode, ctx) => {
      let result;
      if (mode === "timeout") {
        await ctx.ui.select("E2E timeout", ["Wait"], { timeout: 4000 });
        result = await ctx.ui.input("E2E after timeout");
      } else if (mode === "select") {
        result = await ctx.ui.select("E2E select", Array.from({ length: 30 }, (_, i) => "Option " + (i + 1)));
      } else if (mode === "long-title") {
        result = await ctx.ui.select("E2E long-title\\n\\n" + Array.from({ length: 80 }, (_, i) => "Long title line " + (i + 1)).join("\\n"), ["Confirm", "Cancel"]);
      } else if (mode === "custom-long") {
        result = await ctx.ui.custom((_tui, _theme, _kb, done) => ({
          render: () => ["E2E custom first line", ...Array.from({ length: 98 }, (_, i) => "E2E custom body line " + (i + 1)), "E2E custom last line"],
          handleInput: (data) => { if (data === "\\x03") done("closed"); },
        }));
      } else {
        result = await ctx.ui[mode]("E2E " + mode, "Details");
      }
      ctx.ui.notify("E2E " + mode + " result: " + String(result));
    },
  });
}`;

export async function checkExtensionDialogs(page, artifacts, width) {
  const commands = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) {
      commands.push(request.postDataJSON());
    }
  };
  page.on("request", onRequest);
  const start = async (mode) => {
    await page.mouse.move(0, 0);
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    const input = page.locator("textarea").last();
    await input.fill(`/e2e-dialog ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const dialog = mode === "long-title"
      ? page.getByRole("dialog", { name: /^E2E long-title/ })
      : mode === "custom-long"
        ? page.getByRole("dialog").last()
        : page.getByRole("dialog", { name: `E2E ${mode}`, exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const finish = async (mode, result) => {
    await page.getByText(`E2E ${mode} result: ${result}`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };

  try {
    const select = await start("select");
    await page.waitForFunction(() => document.activeElement?.textContent === "Option 1");
    for (const [key, expected] of [["ArrowUp", "Option 30"], ["ArrowDown", "Option 1"], ["ArrowRight", "Option 2"], ["ArrowLeft", "Option 1"], ["End", "Option 30"], ["Home", "Option 1"], ["End", "Option 30"]]) {
      await page.keyboard.press(key);
      assert.equal(await page.locator(":focus").textContent(), expected);
    }
    assert.ok(await page.locator(":focus").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement.parentElement.getBoundingClientRect();
      return bounds.top >= container.top && bounds.bottom <= container.bottom;
    }), "Keyboard selection must scroll into view");
    await page.screenshot({ path: join(artifacts, `extension-select-${width}.png`) });
    await page.keyboard.press("Enter");
    await select.waitFor({ state: "hidden" });
    await finish("select", "Option 30");

    {
      const dialog = await start("long-title");
      const header = dialog.locator(":scope > div").first();
      const option = dialog.getByRole("button", { name: "Confirm", exact: true });
      const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
      await option.waitFor({ state: "visible" });
      await cancel.waitFor({ state: "visible" });
      assert.ok(await header.evaluate((element) => element.scrollHeight > element.clientHeight), "A long select title must scroll within its header");
      await header.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      assert.ok(await option.isVisible(), "Options must remain available while scrolling a long title");
      assert.ok(await cancel.isVisible(), "Dialog actions must remain available while scrolling a long title");
      await page.screenshot({ path: join(artifacts, `extension-long-title-${width}.png`) });
      await option.click();
      await dialog.waitFor({ state: "hidden" });
      await finish("long-title", "Confirm");
    }

    {
      const dialog = await start("custom-long");
      const output = dialog.locator("pre");
      const { maxHeight, viewportHeight } = await output.evaluate((element) => ({
        maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
        viewportHeight: window.innerHeight,
      }));
      const expectedMaxHeight = Math.min(viewportHeight * 0.35, 260);
      assert.ok(Math.abs(maxHeight - expectedMaxHeight) <= 1, `Output max-height ${maxHeight}px must equal min(35vh, 260px)`);
      assert.ok(await output.evaluate((element) => element.scrollHeight > element.clientHeight), "Long custom output must scroll inside the panel");
      const isVisibleInOutput = (text) => output.evaluate((element, expectedText) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const start = textNode.textContent?.indexOf(expectedText) ?? -1;
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(textNode, start);
          range.setEnd(textNode, start + expectedText.length);
          const bounds = range.getBoundingClientRect();
          const viewport = element.getBoundingClientRect();
          return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
        }
        return false;
      }, text);
      assert.ok(await isVisibleInOutput("E2E custom first line"), "The first custom output line must be visible at the top");
      await output.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      assert.ok(await output.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight), "The output must scroll to its end");
      assert.ok(await isVisibleInOutput("E2E custom last line"), "The last custom output line must be visible at the end");
      await output.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: join(artifacts, `extension-custom-long-${width}.png`) });
      await dialog.getByRole("button", { name: "Collapse", exact: true }).click();
      await page.getByRole("button", { name: /Awaiting response.*Extension panel/ }).click();
      assert.ok(await output.evaluate((element) => element.scrollHeight > element.clientHeight), "Custom output remains scrollable after collapse and re-expand");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await finish("custom-long", "closed");
    }

    for (const mode of ["select", "confirm", "input", "editor"]) {
      const dialog = await start(mode);
      assert.ok(await page.locator(":focus").evaluate(element => element.closest('[role="dialog"]')));
      if (mode === "input" || mode === "editor") {
        await dialog.getByRole("textbox").fill("Preserved draft");
        await dialog.getByRole("button", { name: "Collapse", exact: true }).click();
        await page.getByRole("button", { name: new RegExp(`Awaiting response.*E2E ${mode}`) }).click();
        assert.equal(await dialog.getByRole("textbox").inputValue(), "Preserved draft");
      }
      if (mode === "input" || mode === "editor") await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
      const before = commands.length;
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await finish(mode, mode === "confirm" ? "false" : "undefined");
      assert.equal(commands.slice(before).filter(command => command.type === "extension_ui_response").length, 1);
      assert.equal(commands.slice(before).some(command => command.type === "abort"), false, "Dialog Esc must not abort the agent");
    }

    const timed = await start("timeout");
    const countdown = timed.getByText(/expires in \ds/);
    await countdown.waitFor();
    const initialCountdown = await countdown.innerText();
    await page.waitForFunction(initial => {
      const text = document.querySelector('[role="dialog"]')?.textContent;
      return text?.includes("expires in") && !text.includes(initial);
    }, initialCountdown);
    const before = commands.length;
    await timed.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.getByRole("button", { name: /Awaiting response.*E2E timeout.*expires in/ }).waitFor();
    const afterTimeout = page.getByRole("dialog", { name: "E2E after timeout", exact: true });
    await afterTimeout.waitFor();
    assert.equal(commands.slice(before).some(command => command.type === "extension_ui_response"), false, "Only the server closes expired requests");
    assert.equal(await afterTimeout.getByText(/expires in/).count(), 0);
    await afterTimeout.getByRole("textbox").fill("Still answerable");
    await page.keyboard.press("Enter");
    await finish("timeout", "Still answerable");
    console.log(`PASS: ${width}px extension keyboard navigation, cancel, draft preservation, and server expiry`);
  } finally {
    page.off("request", onRequest);
  }
}
