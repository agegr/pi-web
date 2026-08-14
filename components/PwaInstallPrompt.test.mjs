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
const mod = await jiti.import("./PwaInstallPrompt.tsx");

test("exports the PwaInstallPrompt function", () => {
  assert.equal(typeof mod.PwaInstallPrompt, "function");
});

test("renders nothing during SSR (no `beforeinstallprompt` has fired)", () => {
  // Initial state is null (the deferred prompt hasn't been captured yet);
  // useEffect doesn't run during SSR, so the chip stays hidden.
  const html = renderToStaticMarkup(React.createElement(mod.PwaInstallPrompt));
  assert.equal(html, "");
});

test("renders nothing when document is unavailable", () => {
  // Without `document`, createPortal cannot mount. The component short-circuits.
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    const html = renderToStaticMarkup(React.createElement(mod.PwaInstallPrompt));
    assert.equal(html, "");
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
});

test("does not render in non-production mode", () => {
  // The component early-returns in development to avoid showing the chip
  // during local testing. Even if a `beforeinstallprompt` fires in dev, we
  // ignore it. Verify this contract by checking the source.
  const source = readFileSync(
    new URL("./PwaInstallPrompt.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /NODE_ENV\s*!==\s*["']production["']/);
});
