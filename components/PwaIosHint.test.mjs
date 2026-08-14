import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const mod = await jiti.import("./PwaIosHint.tsx");

test("exports the PwaIosHint function", () => {
  assert.equal(typeof mod.PwaIosHint, "function");
});

test("renders nothing during SSR (UA detection runs in useEffect)", () => {
  const html = renderToStaticMarkup(React.createElement(mod.PwaIosHint));
  assert.equal(html, "");
});

test("renders nothing when navigator is unavailable", () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
    const html = renderToStaticMarkup(React.createElement(mod.PwaIosHint));
    assert.equal(html, "");
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("uses a 30-day TTL for the dismissal key", () => {
  // The TTL is encoded in the module source. If the dismiss window shrinks
  // (e.g. someone changes 30 → 1) we want this test to flag it.
  const source = readFileSync(
    new URL("./PwaIosHint.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /30\s*\*\s*24\s*\*\s*3600\s*\*\s*1000/);
  assert.match(source, /pi-ios-install-hint-dismissed/);
});
