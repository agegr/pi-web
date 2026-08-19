import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// Import the manifest route handler via jiti (handles TS + path alias).
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { default: manifest } = await jiti.import("../app/manifest.ts");

test("manifest declares standalone display with Pi Web identity", () => {
  const m = manifest();
  assert.equal(m.name, "Pi Web");
  assert.equal(m.short_name, "Pi Web");
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.orientation, "any");
  assert.equal(m.background_color, "#ffffff");
  assert.equal(m.theme_color, "#f5f5f5");
});

test("manifest includes a maskable icon for Android adaptive icons", () => {
  const m = manifest();
  const maskable = m.icons.find((i) => i.purpose === "maskable");
  assert.ok(maskable, "manifest.icons must include a maskable entry");
  assert.equal(maskable.src, "/icons/icon-512-maskable.png");
  assert.equal(maskable.sizes, "512x512");
  assert.equal(maskable.type, "image/png");
});

test("manifest keeps the existing 'any' purpose icons", () => {
  const m = manifest();
  const any = m.icons.filter((i) => i.purpose === "any");
  assert.equal(any.length, 2);
  assert.ok(any.some((i) => i.src === "/icons/icon-192.png"));
  assert.ok(any.some((i) => i.src === "/icons/icon-512.png"));
});

test("manifest declares both wide and narrow screenshots", () => {
  const m = manifest();
  assert.ok(Array.isArray(m.screenshots));
  assert.equal(m.screenshots.length, 2);
  const wide = m.screenshots.find((s) => s.form_factor === "wide");
  const narrow = m.screenshots.find((s) => s.form_factor === "narrow");
  assert.ok(wide);
  assert.ok(narrow);
  assert.equal(wide.sizes, "1280x720");
  assert.equal(narrow.sizes, "750x1334");
});

test("manifest declares a 'New session' shortcut", () => {
  const m = manifest();
  assert.ok(Array.isArray(m.shortcuts));
  assert.ok(m.shortcuts.length >= 1);
  const newSession = m.shortcuts.find((s) => s.name === "New session");
  assert.ok(newSession);
  assert.equal(newSession.url, "/?action=new");
  assert.ok(newSession.icons.length >= 1);
  assert.equal(newSession.icons[0].src, "/icons/shortcut-new.png");
  assert.equal(newSession.icons[0].sizes, "96x96");
});
