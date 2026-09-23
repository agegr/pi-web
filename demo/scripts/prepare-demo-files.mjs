#!/usr/bin/env node
// Snapshot the Pi Web repository into public/demo-files so the demo's file
// explorer and viewer can browse real project files without a backend.
//
// Every git-tracked file outside demo/ is copied under a hashed name (GitHub
// Pages drops dot-directories such as .github from the upload), and
// manifest.json maps each repository path to its asset.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(demoDir, "..");
const outDir = join(demoDir, "public", "demo-files");
const assetDir = join(outDir, "f");
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Keep extensions only where the browser needs the right content type to
// render the file directly (<img>, <audio>, <iframe>); text is served as .txt.
const MEDIA_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif", ".pdf", ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov", ".docx"]);

const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((path) => path && !path.startsWith("demo/"));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetDir, { recursive: true });

const files = [];
for (const path of tracked.sort()) {
  let size;
  try {
    size = statSync(join(repoDir, path)).size;
  } catch {
    continue; // deleted in the working tree
  }
  if (size > MAX_FILE_BYTES) continue;
  const ext = extname(path);
  const asset = createHash("sha1").update(path).digest("hex").slice(0, 16) + (MEDIA_EXT.has(ext.toLowerCase()) ? ext.toLowerCase() : ".txt");
  copyFileSync(join(repoDir, path), join(assetDir, asset));
  files.push({ path, size, asset });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ files }));
console.log(`[demo] copied ${files.length} project files into public/demo-files`);
