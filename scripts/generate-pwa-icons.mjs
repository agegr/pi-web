#!/usr/bin/env node
// Generate derived PWA assets from public/icons/icon-512.png:
//   - public/icons/icon-512-maskable.png   (512x512 with 8% safe zone)
//   - public/icons/shortcut-new.png        (96x96)
//   - public/screenshots/desktop-wide.png  (1280x720)
//   - public/screenshots/mobile-narrow.png (750x1334)
//
// Idempotent — re-running overwrites the four target PNGs.
// Run from project root: node scripts/generate-pwa-icons.mjs
// or:                   pnpm icons:generate

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BG = "#1a1a1a";
const FG = "#ffffff";
const MUTED = "#9ca3af";

const input = resolve(root, "public/icons/icon-512.png");
const base = sharp(input).png();

await mkdir(resolve(root, "public/icons"), { recursive: true });
await mkdir(resolve(root, "public/screenshots"), { recursive: true });

// 1) Maskable: solid #1a1a1a background, icon centered, scaled to ~80% so the
//    inner ~82% is the safe zone (Android adaptive icon spec recommends the
//    important content stays within a circle of radius ~40% of the canvas).
const SAFE_INSET = 410; // icon occupies the inner 410x410 of the 512x512 canvas
await sharp({
  create: { width: 512, height: 512, channels: 4, background: BG },
})
  .composite([
    {
      input: await base
        .clone()
        .resize(SAFE_INSET, SAFE_INSET, { fit: "contain" })
        .png()
        .toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toFile(resolve(root, "public/icons/icon-512-maskable.png"));

// 2) 96x96 shortcut icon (no safe zone needed — purpose: "any")
await base
  .clone()
  .resize(96, 96, { fit: "contain" })
  .png()
  .toFile(resolve(root, "public/icons/shortcut-new.png"));

// 3) Synthetic screenshots. Spec-compliant PNGs at the sizes Lighthouse expects,
//    composed from an inline SVG (no font registration needed) with the existing
//    icon composited on top.
async function screenshot(width, height, file) {
  const iconSize = Math.round(width * 0.18);
  const iconBuf = await base
    .clone()
    .resize(iconSize, iconSize, { fit: "contain" })
    .png()
    .toBuffer();

  const titleSize = Math.round(width * 0.06);
  const subtitleSize = Math.round(width * 0.025);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="50%" y="${(height * 0.62) | 0}" text-anchor="middle"
        font-family="Segoe UI, system-ui, -apple-system, sans-serif"
        font-size="${titleSize}" font-weight="700" fill="${FG}">Pi Web</text>
  <text x="50%" y="${(height * 0.72) | 0}" text-anchor="middle"
        font-family="Segoe UI, system-ui, -apple-system, sans-serif"
        font-size="${subtitleSize}" fill="${MUTED}">Local web interface for the pi coding agent</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: iconBuf, gravity: "center" }])
    .png()
    .toFile(resolve(root, file));
}

await screenshot(1280, 720, "public/screenshots/desktop-wide.png");
await screenshot(750, 1334, "public/screenshots/mobile-narrow.png");

console.log("Generated maskable + shortcut + 2 screenshots under public/.");
