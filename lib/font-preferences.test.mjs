import assert from "node:assert/strict";
import test from "node:test";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_OPTIONS, fontFamilyCss, fontFamilyOverride, readFontPreference, readFontWeight } from "./font-preferences.ts";

test("font preferences preserve editable whitespace and bound malformed storage", () => {
  assert.equal(readFontPreference("Times New "), "Times New ");
  for (const value of [null, undefined, 123, {}, "a".repeat(FONT_FAMILY_MAX_LENGTH + 1)]) {
    assert.equal(readFontPreference(value), "");
  }
  assert.equal(readFontPreference("a".repeat(FONT_FAMILY_MAX_LENGTH)).length, FONT_FAMILY_MAX_LENGTH);
});

test("font weights default to Regular, accept 100-600 and reject heavier or invalid storage", () => {
  assert.deepEqual(FONT_WEIGHT_OPTIONS.map(({ value }) => value), [100, 200, 300, 400, 500, 600]);
  for (const { value } of FONT_WEIGHT_OPTIONS) {
    assert.equal(readFontWeight(value), value);
    assert.equal(readFontWeight(String(value)), value);
  }
  for (const value of [undefined, null, "", "Light", "normal", "400px", {}, true, 0, -100, 700, 900, 1000, 550, NaN, Infinity]) {
    assert.equal(readFontWeight(value), 400);
  }
});

test("font names support lists, Chinese, optional quotes, and explicit generic families", () => {
  assert.equal(fontFamilyCss('  JetBrains Mono, "PingFang SC", 微软雅黑, monospace, '), '"JetBrains Mono", "PingFang SC", "微软雅黑", monospace');
  assert.equal(fontFamilyCss("'Times New Roman', SERIF"), '"Times New Roman", serif');
  assert.equal(fontFamilyCss('"monospace", system-ui'), '"monospace", system-ui');
  assert.equal(fontFamilyCss(" , , \t"), "");
  assert.equal(fontFamilyCss('""'), "");
  assert.equal(fontFamilyCss(null), "");
});

test("names are CSS string data, not variables, keywords, declarations or downloads", () => {
  for (const value of ['A "quoted" font', "C:\\fonts", "inherit", "initial", "var(--font-ui)", "url(https://example.com/font.woff2)", 'x\";color:red}/*', "</style><script>alert(1)</script>"]) {
    assert.equal(fontFamilyCss(value), JSON.stringify(value));
  }
});

test("custom fonts retain the original stacks and empty input removes only the override", () => {
  assert.equal(fontFamilyOverride("ui", "Arial"), '"Arial", var(--font-ui-default)');
  assert.equal(fontFamilyOverride("mono", "Menlo, monospace"), '"Menlo", monospace, var(--font-mono-default)');
  assert.equal(fontFamilyOverride("ui", ""), "");
  assert.equal(fontFamilyOverride("mono", " , "), "");
});
