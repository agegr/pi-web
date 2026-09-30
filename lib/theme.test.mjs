import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_INIT_SCRIPT, THEME_OPTIONS, isDarkTheme, isThemePreference } from "./theme.ts";

const ids = THEME_OPTIONS.map(({ id }) => id);

test("offers the Catppuccin palettes between Pine and System", () => {
  assert.deepEqual(ids, ["light", "dark", "mist", "rose", "pine", "latte", "mocha", "auto"]);
});

test("treats Mocha as dark and Latte as light", () => {
  assert.equal(isDarkTheme("mocha"), true);
  assert.equal(isDarkTheme("latte"), false);
  assert.equal(isDarkTheme("pine"), true);
  assert.equal(isDarkTheme("light"), false);
});

test("accepts every palette id and rejects anything else", () => {
  for (const id of ids) assert.equal(isThemePreference(id), true);
  for (const value of ["Latte", "catppuccin", "mocha ", 0, null, undefined, ""]) {
    assert.equal(isThemePreference(value), false);
  }
});

test("first paint restores every palette and falls back to the system for invalid or blocked storage", () => {
  for (const systemDark of [false, true]) {
    for (const stored of [...THEME_OPTIONS.map(({ id }) => id), null, "", "unknown", new Error("Blocked")]) {
      const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      const expected = isThemePreference(stored) && stored !== "auto" ? stored : systemDark ? "dark" : "light";
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dark, isDarkTheme(expected));
    }
  }
});
