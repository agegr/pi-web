import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const vite = await readFile(new URL("../vite.tanstack.config.ts", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the TanStack root owns global document behavior", () => {
  for (const marker of [
    "Pi Web interface for the pi coding agent",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
    "viewport-fit=cover",
    "interactive-widget=resizes-content",
    "apple-mobile-web-app-capable",
    "format-detection",
    "google",
    "notranslate",
    "pi-theme",
    "PwaRegistration",
    "katex/dist/katex.min.css",
    "@/app/globals.css",
  ]) assert.match(root, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Noto Sans Mono is local and keeps the existing CSS variable", () => {
  assert.equal(pkg.dependencies["@fontsource-variable/noto-sans-mono"], "5.3.0");
  assert.match(root, /@fontsource-variable\/noto-sans-mono/);
  assert.match(css, /--font-noto-mono/);
});

test("Vite defines the two existing public version variables", () => {
  assert.match(vite, /process\.env\.NEXT_PUBLIC_APP_VERSION/);
  assert.match(vite, /process\.env\.NEXT_PUBLIC_PI_VERSION/);
});
