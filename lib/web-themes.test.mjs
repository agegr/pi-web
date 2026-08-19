import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PALETTES,
  VALID_PALETTE_IDS,
  readStoredPalette,
  persistPalette,
  applyPaletteToDom,
} from "./web-themes.ts";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createDocument() {
  let attr = null;
  return {
    _attr: attr,
    documentElement: {
      setAttribute(name, value) { attr = { name, value }; },
      removeAttribute() { attr = null; },
    },
    get currentAttr() { return attr; },
  };
}

describe("PALETTES", () => {
  it("has at least 12 palettes", () => {
    assert.ok(PALETTES.length >= 12, `expected >= 12 palettes, got ${PALETTES.length}`);
  });

  it("has pi palette as the default", () => {
    const pi = PALETTES.find((p) => p.id === "pi");
    assert.ok(pi, "pi palette not found");
    assert.equal(pi.label, "Pi Signature");
    assert.equal(pi.group, "signature");
  });

  it("has all required palettes", () => {
    const required = ["pi", "midnight", "tokyo-night", "catppuccin", "dracula", "nord", "gruvbox", "rose-pine", "solarized", "cyberpunk", "obsidian", "arctic-light", "paper-ink", "amber-terminal", "cursor", "claude", "codex", "devin", "replit", "linear", "vercel", "github-dark", "zed", "warp", "roo", "aider", "reasonix", "agentic"];
    for (const id of required) {
      assert.ok(VALID_PALETTE_IDS.has(id), `palette ${id} not in VALID_PALETTE_IDS`);
    }
  });

  it("each palette has 4 swatch colors", () => {
    for (const palette of PALETTES) {
      assert.equal(palette.swatch.length, 4, `${palette.id} swatch should have 4 colors`);
      for (const c of palette.swatch) {
        assert.ok(/^#[0-9a-fA-F]{6}$/.test(c), `${palette.id} swatch color invalid: ${c}`);
      }
    }
  });

  it("each palette has a group and descriptor", () => {
    for (const palette of PALETTES) {
      assert.ok(["signature", "ai", "dark", "light", "special"].includes(palette.group), `${palette.id} group invalid`);
      assert.ok(typeof palette.descriptor === "string" && palette.descriptor.length > 0, `${palette.id} missing descriptor`);
    }
  });
});

it("maps legacy solarized-dark/light to solarized", () => {
  assert.equal(readStoredPalette(createStorage({ "pi-web-palette": "solarized-dark" })), "solarized");
  assert.equal(readStoredPalette(createStorage({ "pi-web-palette": "solarized-light" })), "solarized");
});


describe("VALID_PALETTE_IDS", () => {
  it("contains pi", () => {
    assert.ok(VALID_PALETTE_IDS.has("pi"));
  });

  it("rejects unknown palette", () => {
    assert.ok(!VALID_PALETTE_IDS.has("nonexistent"));
  });
});

describe("readStoredPalette", () => {
  it("returns pi when nothing stored", () => {
    assert.equal(readStoredPalette(createStorage()), "pi");
  });

  it("returns stored valid palette", () => {
    const storage = createStorage({ "pi-web-palette": "tokyo-night" });
    assert.equal(readStoredPalette(storage), "tokyo-night");
  });

  it("falls back to pi for invalid palette", () => {
    const storage = createStorage({ "pi-web-palette": "invalid-palette" });
    assert.equal(readStoredPalette(storage), "pi");
  });
});

describe("persistPalette", () => {
  it("stores palette to storage", () => {
    const storage = createStorage();
    persistPalette("dracula", storage);
    assert.equal(storage.getItem("pi-web-palette"), "dracula");
  });

  it("overwrites existing palette", () => {
    const storage = createStorage({ "pi-web-palette": "nord" });
    persistPalette("gruvbox", storage);
    assert.equal(storage.getItem("pi-web-palette"), "gruvbox");
  });
});

describe("applyPaletteToDom", () => {
  it("removes data-palette for pi", () => {
    const doc = createDocument();
    doc.documentElement.setAttribute("data-palette", "tokyo-night");
    applyPaletteToDom("pi", doc);
    assert.equal(doc.currentAttr, null);
  });

  it("sets data-palette for non-pi palettes", () => {
    const doc = createDocument();
    applyPaletteToDom("catppuccin", doc);
    assert.deepEqual(doc.currentAttr, { name: "data-palette", value: "catppuccin" });
  });
});
