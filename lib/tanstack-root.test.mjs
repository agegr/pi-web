import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const vite = await readFile(new URL("../vite.tanstack.config.ts", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

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

test("the static PWA manifest matches the former Next manifest exactly", () => {
  assert.deepEqual(manifest, {
    id: "/",
    name: "Pi Web",
    short_name: "Pi Web",
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#171717",
    theme_color: "#171717",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  });
});

test("Nitro route rules pin the root, service worker, and manifest cache headers", () => {
  assert.match(vite, /routeRules/);
  assert.match(vite, /private, no-cache, max-age=0, must-revalidate/);
  assert.match(vite, /public, max-age=0, must-revalidate/);
  assert.match(vite, /Service-Worker-Allowed.*\//);
  assert.match(vite, /\"\/sw\.js\"/);
  assert.match(vite, /\"\/manifest\.webmanifest\"/);
});
