import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

import { createPaletteTheme, extensionUiTheme, PLAIN_TEXT_THEME } from "./extension-ui-theme.ts";
import { TERMINAL_XTERM_THEMES } from "./terminal-theme.ts";

const { generateSystemThemeColors } = await import(
  `${getPackageDir()}/dist/modes/interactive/theme/system-theme.js`
);

// An SDK upgrade that moves or reshapes pi's system theme generator must fail
// here, not leave extension UI silently plain.
test("pi's system theme for a terminal without colors is palette indices and defaults", () => {
  const generated = generateSystemThemeColors({});
  const values = Object.values(generated.colors);
  assert.ok(values.length > 40);
  assert.ok(values.every((value) => value === "" || (Number.isInteger(value) && value >= 0 && value < 16)));
  assert.equal(generated.colors.text, "");
  assert.ok(generated.dim.includes("muted"));
});

test("the palette theme paints with ANSI palette codes, faint dim tokens and plain text", () => {
  const theme = createPaletteTheme(generateSystemThemeColors({}));
  assert.equal(theme.fg("accent", "a"), "\x1b[38;5;5ma\x1b[39m");
  assert.equal(theme.fg("text", "t"), "\x1b[39mt\x1b[39m");
  assert.match(theme.fg("muted", "m"), /\x1b\[2mm/);
  // chalk would drop these without a TTY; a terminal gets them.
  assert.equal(theme.bold("b"), "\x1b[1mb\x1b[22m");
  assert.equal(theme.italic("i"), "\x1b[3mi\x1b[23m");
});

test("extension UI gets the palette theme once it has loaded", async () => {
  for (let i = 0; i < 50 && extensionUiTheme() === PLAIN_TEXT_THEME; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.notEqual(extensionUiTheme(), PLAIN_TEXT_THEME);
  assert.equal(extensionUiTheme().fg("error", "e"), "\x1b[38;5;1me\x1b[39m");
});

test("the page's ANSI palette is the terminal's, light and dark", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const block = (selector) => {
    const start = css.indexOf(`${selector} {\n  --ansi-black:`);
    assert.ok(start >= 0, `${selector} defines the ANSI palette`);
    return css.slice(start, css.indexOf("}", start));
  };
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  for (const [selector, scheme] of [[":root", "light"], ["html.dark", "dark"]]) {
    const vars = block(selector);
    for (const name of names) {
      const bright = `bright${name[0].toUpperCase()}${name.slice(1)}`;
      assert.match(vars, new RegExp(`--ansi-${name}: ${TERMINAL_XTERM_THEMES[scheme][name]};`));
      assert.match(vars, new RegExp(`--ansi-bright-${name}: ${TERMINAL_XTERM_THEMES[scheme][bright]};`));
    }
  }
  for (const name of names) {
    for (const color of [name, `bright-${name}`]) {
      assert.match(css, new RegExp(`\\.ansi-${color}-fg \\{ color: var\\(--ansi-${color}\\); \\}`));
      assert.match(css, new RegExp(`\\.ansi-${color}-bg \\{ background-color: var\\(--ansi-${color}\\); \\}`));
    }
  }
});
