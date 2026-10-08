"use strict";

// The published npm tarball ships `.next/prerender-manifest.json`, whose
// `preview` block holds the build's preview-mode secrets. One of them,
// `previewModeId`, is the value Next compares against the `x-prerender-revalidate`
// request header: when they match, Next treats the request as an on-demand
// revalidation and skips middleware/proxy entirely (see next-server.js
// `runMiddleware`). Because the value is baked into every published version, an
// attacker who reads the tarball can send that header and bypass `proxy.ts` —
// the central password gate and the Host/Origin/Fetch-Metadata checks.
//
// `next start` reads these secrets only from this file (there is no runtime env
// override) and never regenerates them, so we rewrite the three preview secrets
// with fresh random values before launching Next. That makes the published
// values useless and unique per launch. Done at startup rather than in a
// postinstall hook so it runs on the guaranteed launch path and cannot be
// skipped with `--ignore-scripts`.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PRERENDER_MANIFEST = "prerender-manifest.json";

function freshPreviewSecrets() {
  return {
    // Lengths mirror what Next generates at build time.
    previewModeId: crypto.randomBytes(16).toString("hex"),
    previewModeSigningKey: crypto.randomBytes(32).toString("hex"),
    previewModeEncryptionKey: crypto.randomBytes(32).toString("hex"),
  };
}

/**
 * Rewrite the preview-mode secrets in `.next/prerender-manifest.json` with fresh
 * random values. Never throws: returns a status the caller can surface so a
 * read-only install (where the rewrite cannot happen) is visible rather than a
 * silent bypass.
 *
 * @param {string} nextDir absolute path to the package's `.next` directory
 * @returns {{ ok: boolean, reason?: string, error?: Error }}
 */
function rotatePreviewSecrets(nextDir) {
  const manifestPath = path.join(nextDir, PRERENDER_MANIFEST);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "unreadable", error };
  }

  if (!manifest || typeof manifest !== "object" || typeof manifest.preview !== "object") {
    return { ok: false, reason: "unexpected-shape" };
  }

  manifest.preview = { ...manifest.preview, ...freshPreviewSecrets() };

  // Write to a sibling temp file and rename so a concurrent `next start` never
  // reads a half-written manifest.
  const tempPath = path.join(nextDir, `${PRERENDER_MANIFEST}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(manifest));
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort: leaving a stray temp file is harmless.
    }
    return { ok: false, reason: "unwritable", error };
  }

  return { ok: true };
}

function getRotationWarning(reason) {
  const detail =
    reason === "unwritable"
      ? "the install directory is not writable"
      : reason === "missing"
        ? "its prerender manifest is missing"
        : reason === "unreadable"
          ? "its prerender manifest could not be read"
          : "its prerender manifest has an unexpected format";
  return [
    `Warning: could not rotate pi-web's preview-mode secrets because ${detail}.`,
    "This instance keeps the published preview id, so a client that knows it can",
    "bypass the proxy's authentication and Host/Origin checks via the",
    "x-prerender-revalidate header. Run from a writable install, or restrict",
    "network access to this instance.",
  ].join("\n");
}

module.exports = {
  PRERENDER_MANIFEST,
  rotatePreviewSecrets,
  getRotationWarning,
};
