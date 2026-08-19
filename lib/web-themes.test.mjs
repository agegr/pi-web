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
  it("has at least 6 palettes", () => {
    assert.ok(PALETTES.length >= 6, `expected >= 6 palettes, got ${PALETTES.length}`);
  });

  it("has pi palette", () => {
    const pi = PALETTES.find((p) => p.id === "pi");
    assert.ok(pi, "pi palette not found");
    assert.equal(pi.label, "Pi");
  });

  it("has all required palettes", () => {
    const required = ["pi", "midnight", "tokyo-night", "catppuccin", "dracula", "nord", "gruvbox", "solarized-dark", "solarized-light"];
    for (const id of required) {
      assert.ok(VALID_PALETTE_IDS.has(id), `palette ${id} not in VALID_PALETTE_IDS`);
    }
  });

  it("each palette has 4 swatch colors", () => {
    for (const palette of PALETTES) {
      assert.equal(palette.swatch.length, 4, `${palette.id} swatch should have 4 colors`);
    }
  });
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
