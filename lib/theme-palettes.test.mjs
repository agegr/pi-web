import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_DEFS, THEME_TOKENS } from "./theme-palettes.ts";

const REQUIRED_PALETTES = [
  "pi", "midnight", "tokyo-night", "catppuccin", "dracula", "nord", "gruvbox",
  "rose-pine", "solarized", "cyberpunk", "obsidian", "arctic-light", "paper-ink", "amber-terminal",
  "cursor", "claude", "codex", "devin", "replit", "linear", "vercel", "github-dark", "zed", "warp", "roo", "aider", "reasonix", "agentic",
];

const AI_PALETTES = [
  "cursor", "claude", "codex", "devin", "replit", "linear", "vercel", "github-dark", "zed", "warp", "roo", "aider", "reasonix", "agentic",
];

describe("PALETTE_DEFS", () => {
  it("contains the complete 28-palette collection", () => {
    assert.deepEqual(Object.keys(PALETTE_DEFS).sort(), [...REQUIRED_PALETTES].sort());
  });

  it("ships complete dark and light token maps for every palette", () => {
    for (const [id, def] of Object.entries(PALETTE_DEFS)) {
      for (const mode of ["dark", "light"]) {
        for (const token of THEME_TOKENS) {
          assert.ok(def.tokens[mode][token], `${id}.${mode}.${token} is missing`);
        }
      }
    }
  });

  it("keeps the new collection in the dedicated ai group", () => {
    for (const id of AI_PALETTES) {
      assert.equal(PALETTE_DEFS[id].group, "ai", `${id} should be in ai group`);
    }
  });

  it("keeps every picker swatch base color concrete", () => {
    for (const [id, def] of Object.entries(PALETTE_DEFS)) {
      for (const mode of ["dark", "light"]) {
        for (const token of ["bg", "bg-panel", "accent", "text"]) {
          assert.match(def.tokens[mode][token], /^#[0-9a-fA-F]{6}$/, `${id}.${mode}.${token} must be a hex color`);
        }
      }
    }
  });
});
