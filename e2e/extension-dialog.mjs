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
      } else if (mode === "prose") {
        result = await ctx.ui.confirm("E2E prose", "A long sentence that wraps. ".repeat(60));
      } else if (mode === "code") {
        result = await ctx.ui.confirm("E2E code", "Run this?\\n\\n\`\`\`sql\\n" + "CREATE TABLE t (" + Array.from({ length: 2 }, (_, i) => "column_" + i + " VARCHAR(255) NOT NULL").join(", ") + ");\\n\`\`\`");
      } else if (mode === "huge") {
        result = await ctx.ui.confirm("E2E huge", "\`\`\`sql\\n" + "SELECT " + "column_name, ".repeat(80) + "1;\\n\`\`\`");
      } else if (mode === "panel") {
        result = await ctx.ui.custom((tui, theme, keybindings, done) => ({
          render: (width) => ["E2E panel", "x".repeat(width)],
          handleInput: (data) => { if (data === "\\x03") done("closed"); },
          invalidate() {},
        }), { overlay: true, overlayOptions: { width: 140 } });
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
    const dialog = page.getByRole("dialog", { name: `E2E ${mode}`, exact: true });
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

/** The dialog's width once its content has stopped asking for more room. */
async function settledWidth(page, dialog) {
  return dialog.evaluate(element => new Promise(resolve => {
    let last = -1;
    let steady = 0;
    const check = () => {
      const width = element.getBoundingClientRect().width;
      steady = width === last ? steady + 1 : 0;
      last = width;
      if (steady >= 5) resolve(width);
      else requestAnimationFrame(check);
    };
    check();
  }));
}

/** Width the dialog may use: the content region minus the overlay's own 20px padding. */
function availableWidth(dialog) {
  return dialog.evaluate(element => element.parentElement.clientWidth - 40);
}

function scrollsSideways(dialog) {
  return dialog.evaluate(element => [...element.querySelectorAll("pre, .markdown-table-wrap")]
    .some(block => block.scrollWidth - block.clientWidth > 1));
}

/**
 * Dialogs fit their code blocks without any hint from the extension (#947): prose keeps
 * the 560px default, code that does not fit makes the dialog just wide enough (or as
 * wide as the screen allows), and maximize/restore is a per-dialog override.
 */
export async function checkExtensionDialogSizing(page, width) {
  const start = async (mode, name = `E2E ${mode}`) => {
    await page.mouse.move(0, 0);
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    await page.locator("textarea").last().fill(`/e2e-dialog ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const dialog = page.getByRole("dialog", name === null ? undefined : { name, exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const close = async (dialog, mode, result) => {
    await dialog.getByRole("button", { name: mode === "panel" ? "Close" : "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText(`E2E ${mode} result: ${result}`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };

  const prose = await start("prose");
  const proseWidth = await settledWidth(page, prose);
  const available = await availableWidth(prose);
  assert.ok(Math.abs(proseWidth - Math.min(560, available)) <= 1, `Prose keeps the default width, got ${proseWidth}px of ${available}px`);
  await close(prose, "prose", "false");

  const code = await start("code");
  const codeWidth = await settledWidth(page, code);
  assert.ok(codeWidth >= proseWidth, "A code block never makes the dialog narrower");
  assert.ok(codeWidth <= available + 1, "The dialog stays inside the content region");
  if (width > 600) assert.ok(codeWidth > 560, `Code that cannot fit in 560px widens the dialog, got ${codeWidth}px`);
  if (codeWidth < available - 1) assert.equal(await scrollsSideways(code), false, "The code block shows whole unless the screen is the limit");

  // Maximize is a per-dialog override: full width, and restore goes back to the fitted width.
  await code.getByRole("button", { name: "Maximize", exact: true }).click();
  assert.ok(Math.abs((await settledWidth(page, code)) - available) <= 1, "Maximize fills the content region");
  await code.getByRole("button", { name: "Restore size", exact: true }).click();
  assert.equal(await settledWidth(page, code), codeWidth, "Restore returns to the fitted width");
  await close(code, "code", "false");

  // The next dialog starts from its own content, not from the last maximize or fit.
  const again = await start("prose");
  assert.ok(Math.abs((await settledWidth(page, again)) - proseWidth) <= 1, "A later dialog does not inherit the previous size");
  await close(again, "prose", "false");

  const huge = await start("huge");
  assert.ok(Math.abs((await settledWidth(page, huge)) - available) <= 1, "Content wider than the screen caps at the content region");
  await close(huge, "huge", "false");

  // A custom panel shows its lines whole when they are wider than 920px and the screen allows.
  const panel = await start("panel", null);
  const panelWidth = await settledWidth(page, panel);
  const panelAvailable = await availableWidth(panel);
  assert.ok(panelWidth <= panelAvailable + 1, "The panel stays inside the content region");
  if (panelWidth < panelAvailable - 1) assert.equal(await scrollsSideways(panel), false, "A panel that is not capped shows its lines whole");
  assert.ok(panelWidth >= Math.min(920, panelAvailable) - 1, "The panel is never narrower than before");
  await close(panel, "panel", "closed");

  console.log(`PASS: ${width}px extension dialogs fit their content (prose ${Math.round(proseWidth)}px, code ${Math.round(codeWidth)}px, panel ${Math.round(panelWidth)}px of ${Math.round(available)}px)`);
}
