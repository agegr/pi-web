const fs = require("fs");
const path = require("path");

const dst = process.argv[2];
const src = process.argv[3];

// Mirrors the "files" exclusions in package.json to keep the deployed
// .next directory lean — dev artifacts and source maps are never used by
// "next start" (the pi-web global command).
const SKIP_DIRS = new Set(["cache", "dev"]);
const SKIP_FILE = /\.js\.map$/;

function shouldSkip(entryName, isDir, depth) {
  // Only skip cache/dev at the .next root (depth 0), not in nested node_modules.
  if (depth === 0 && isDir && SKIP_DIRS.has(entryName)) return true;
  if (!isDir && SKIP_FILE.test(entryName)) return true;
  return false;
}

function copyDir(srcDir, dstDir, depth) {
  if (depth === undefined) depth = 0;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (shouldSkip(entry.name, entry.isDirectory(), depth)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    // Check if this entry is a symlink/junction (pnpm virtual store links)
    let isSymlink = false;
    try {
      isSymlink = entry.isSymbolicLink();
    } catch {
      // On Windows, isSymbolicLink may not be available on older Node
    }
    // fallback: lstat to detect symlinks
    if (!isSymlink) {
      try {
        const stat = fs.lstatSync(srcPath);
        isSymlink = stat.isSymbolicLink();
      } catch {
        // ignore
      }
    }

    if (isSymlink) {
      // Resolve the symlink target and copy actual content
      try {
        const realPath = fs.realpathSync(srcPath);
        const realStat = fs.statSync(realPath);
        if (realStat.isDirectory()) {
          copyDir(realPath, dstPath, depth + 1);
        } else {
          fs.copyFileSync(realPath, dstPath);
        }
      } catch (err) {
        console.warn("skip symlink:", srcPath, err.message);
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, dstPath, depth + 1);
    } else {
      try {
        fs.copyFileSync(srcPath, dstPath);
      } catch (err) {
        console.warn("skip file:", srcPath, err.message);
      }
    }
  }
}

// Remove old .next
try {
  fs.rmSync(dst, { recursive: true, force: true, maxRetries: 3 });
} catch (err) {
  console.warn("rm failed:", err.message);
}

copyDir(src, dst);
console.log("DONE");
