import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { filterInstalledFonts, isFontFamilySelected, parseFontFamilies } = await jiti.import("./font-picker.ts");

const FONTS = [
  { family: "Test Mono", aliases: [], monospace: true },
  { family: "Test Sans", aliases: ["霞鹜文楷"], monospace: false },
  { family: "Test Serif", aliases: [], monospace: false },
];

test("the field's names are read back the way the override writes them", () => {
  assert.deepEqual(parseFontFamilies(""), []);
  assert.deepEqual(parseFontFamilies("Test Sans"), ["Test Sans"]);
  assert.deepEqual(parseFontFamilies('"霞鹜文楷", Test Sans'), ["霞鹜文楷", "Test Sans"]);
  assert.deepEqual(parseFontFamilies("  Test   Sans ,,"), ["Test Sans"]);
  assert.deepEqual(parseFontFamilies('"Test Sans'), ['"Test Sans']);
});

test("a family counts as selected in any position and case", () => {
  assert.equal(isFontFamilySelected("Test Sans", "Test Sans"), true);
  assert.equal(isFontFamilySelected('"Test Sans"', "test sans"), true);
  assert.equal(isFontFamilySelected('"Test Sans", Test Mono', "Test Mono"), true);
  assert.equal(isFontFamilySelected("霞鹜文楷", "霞鹜文楷"), true);
  assert.equal(isFontFamilySelected("Test Sans", "Test Serif"), false);
  assert.equal(isFontFamilySelected("", "Test Sans"), false);
});

test("the picker matches family names and localized aliases", () => {
  assert.deepEqual(filterInstalledFonts(FONTS, "", "ui").map((font) => font.family), ["Test Mono", "Test Sans", "Test Serif"]);
  assert.deepEqual(filterInstalledFonts(FONTS, "sans", "ui").map((font) => font.family), ["Test Sans"]);
  assert.deepEqual(filterInstalledFonts(FONTS, "霞鹜文楷", "ui").map((font) => font.family), ["Test Sans"]);
  assert.deepEqual(filterInstalledFonts(FONTS, "nothing", "ui"), []);
});

test("the mono field lists fixed-pitch families first and keeps the rest reachable", () => {
  assert.deepEqual(filterInstalledFonts(FONTS, "", "mono").map((font) => font.family), ["Test Mono", "Test Sans", "Test Serif"]);
  const proportionalFirst = [
    { family: "Test Sans", aliases: [], monospace: false },
    { family: "Test Mono", aliases: [], monospace: true },
  ];
  assert.deepEqual(filterInstalledFonts(proportionalFirst, "", "mono").map((font) => font.family), ["Test Mono", "Test Sans"]);
});
