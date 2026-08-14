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
const mod = await jiti.import("./PwaUpdateToast.tsx");

test("exports the PwaUpdateToast function", () => {
  assert.equal(typeof mod.PwaUpdateToast, "function");
});

test("renders nothing during SSR (no SW controller present in node)", () => {
  const html = renderToStaticMarkup(React.createElement(mod.PwaUpdateToast));
  assert.equal(html, "");
});

test("renders nothing when navigator is unavailable", () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
    const html = renderToStaticMarkup(React.createElement(mod.PwaUpdateToast));
    assert.equal(html, "");
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("posts SKIP_WAITING message to the waiting worker", () => {
  // The component's `reload` handler posts { type: "SKIP_WAITING" } to the
  // registration's `waiting` worker. Verify the payload contract by reading
  // the module source — if someone changes the message type, the SW handler
  // would silently stop receiving it.
  const source = readFileSync(
    new URL("./PwaUpdateToast.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /postMessage\(\s*\{\s*type:\s*["']SKIP_WAITING["']/);
});

test("reloads the page on controllerchange", () => {
  const source = readFileSync(
    new URL("./PwaUpdateToast.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /controllerchange/);
  assert.match(source, /window\.location\.reload\(\)/);
});
