import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PALETTE_DEFS,
  THEME_TOKENS,
  THEME_TOKEN_SET,
} from "./theme-palettes.ts";

const REQUIRED_PALETTES = [
  "pi",
  "midnight",
  "tokyo-night",
  "catppuccin",
  "dracula",
  "nord",
  "gruvbox",
  "rose-pine",
  "solarized",
  "cyberpunk",
  "obsidian",
  "arctic-light",
  "paper-ink",
  "amber-terminal",
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const SUPPORTED_FN = /^(rgba?\(|color-mix\()/;

const MODES = ["dark", "light"];

describe("PALETTE_DEFS", () => {
  it("defines every required palette", () => {
    for (const id of REQUIRED_PALETTES) {
      assert.ok(PALETTE_DEFS[id], `missing palette ${id}`);
    }
  });

  it("defines exactly the expected palette set", () => {
    const ids = Object.keys(PALETTE_DEFS).sort();
    assert.deepEqual(ids, [...REQUIRED_PALETTES].sort());
  });

  it("every palette ships both a dark and a light token map", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      const def = PALETTE_DEFS[id];
      assert.ok(def.tokens.dark, `${id} missing dark`);
      assert.ok(def.tokens.light, `${id} missing light`);
    }
  });

  it("every token map contains all semantic tokens", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      for (const mode of MODES) {
        const toks = PALETTE_DEFS[id].tokens[mode];
        for (const t of THEME_TOKENS) {
          assert.ok(t in toks, `${id} ${mode} missing token ${t}`);
          assert.notEqual(toks[t], undefined, `${id} ${mode} ${t} is undefined`);
        }
      }
    }
  });

  it("token values are valid CSS colors (hex / rgba / color-mix)", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      for (const mode of MODES) {
        for (const [t, v] of Object.entries(PALETTE_DEFS[id].tokens[mode])) {
          assert.ok(
            HEX.test(v) || SUPPORTED_FN.test(v),
            `${id} ${mode} ${t} invalid color: ${v}`,
          );
        }
      }
    }
  });

  it("token keys match the exported token set", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      for (const mode of MODES) {
        for (const k of Object.keys(PALETTE_DEFS[id].tokens[mode])) {
          assert.ok(THEME_TOKEN_SET.has(k), `${id} ${mode} unknown token ${k}`);
        }
      }
    }
  });
});

describe("Theme distinctness (no accidental hue-swaps)", () => {
  it("dark and light backgrounds and text differ", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      const def = PALETTE_DEFS[id];
      assert.notEqual(
        def.tokens.dark.bg.toLowerCase(),
        def.tokens.light.bg.toLowerCase(),
        `${id} dark/light bg identical`,
      );
      assert.notEqual(
        def.tokens.dark.text.toLowerCase(),
        def.tokens.light.text.toLowerCase(),
        `${id} dark/light text identical`,
      );
    }
  });

  it("status colors are present and distinct from each other", () => {
    for (const id of Object.keys(PALETTE_DEFS)) {
      for (const mode of MODES) {
        const t = PALETTE_DEFS[id].tokens[mode];
        assert.notEqual(t["success"].toLowerCase(), t["error"].toLowerCase(), `${id} ${mode} success==error`);
        assert.notEqual(t["warning"].toLowerCase(), t["info"].toLowerCase(), `${id} ${mode} warning==info`);
        assert.ok(HEX.test(t.accent), `${id} ${mode} accent invalid`);
      }
    }
  });

  it("the accent colors are pairwise distinct across themes", () => {
    const accents = Object.values(PALETTE_DEFS).map((d) => d.tokens.dark.accent.toLowerCase());
    assert.equal(new Set(accents).size, accents.length, "duplicate accents across themes");
  });
});
