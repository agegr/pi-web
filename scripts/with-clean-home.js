#!/usr/bin/env node
// Windows-only: Next.js 16 / webpack 5 scans the user's home directory during
// compilation. Shell-folder symlinks ("Cookies" -> "INetCookies",
// "Application Data" -> "AppData\\Roaming", ...) point at protected targets
// and yield EPERM, which fails the build. Pointing HOME/USERPROFILE at a
// clean temp dir before spawning the real command sidesteps this entirely.
//
// On non-Windows this is a transparent passthrough.
//
// Usage: node scripts/with-clean-home.js <command> [args...]
//
// We resolve bare command names (e.g. "next") to their target entry script
// inside the corresponding package, so we can invoke them directly via
// `node` without going through cmd.exe's .cmd shim (which is hard to escape
// correctly and triggers Node's DEP0190 deprecation).

"use strict";

const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const [, , command, ...rest] = process.argv;
if (!command) {
  console.error("Usage: with-clean-home.js <command> [args...]");
  process.exit(2);
}

if (process.platform !== "win32") {
  spawnPassthrough(command, rest);
} else {
  runWithCleanHome(command, rest);
}

function spawnPassthrough(cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", shell: false });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

/**
 * Read the package.json `bin` field of the package that owns the .cmd shim
 * we matched in node_modules/.bin, so we can find the actual JS entry to
 * invoke directly (no cmd.exe, no .cmd quoting).
 */
function resolveFromShim(shimPath) {
  // .bin/<name>.cmd -> ../<package>/package.json (typically)
  // e.g. node_modules/.bin/next.cmd -> node_modules/next/package.json
  const binDir = dirname(shimPath);
  const projectRoot = process.cwd();
  let dir = projectRoot;
  const seen = new Set();
  while (!seen.has(dir)) {
    seen.add(dir);
    const candidate = join(dir, "node_modules", "next", "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8"));
        const binEntry = pkg.bin?.[basename(shimPath, ".cmd")];
        if (binEntry) {
          return resolve(dir, "node_modules", "next", binEntry);
        }
      } catch { /* fall through */ }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function basename(p, ext) {
  const base = p.split(/[\\/]/).pop() ?? p;
  if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}

function resolveCommand(cmd) {
  if (process.platform !== "win32") return { file: cmd, args: [] };
  if (cmd.includes("/") || cmd.includes("\\") || /^[a-zA-Z]:/.test(cmd)) {
    return { file: cmd, args: [] };
  }

  const projectRoot = process.cwd();
  let dir = projectRoot;
  const seen = new Set();
  while (!seen.has(dir)) {
    seen.add(dir);
    const binDir = join(dir, "node_modules", ".bin");
    for (const ext of [".cmd", ".ps1", ".exe", ""]) {
      const shim = join(binDir, cmd + ext);
      if (existsSync(shim)) {
        if (ext === ".cmd" || ext === ".ps1") {
          const target = resolveFromShim(shim);
          if (target) return { file: process.execPath, args: [target] };
        }
        return { file: shim, args: [] };
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return { file: cmd, args: [] };
}

function runWithCleanHome(cmd, args) {
  const cleanHome = mkdtempSync(join(tmpdir(), "pi-web-clean-home-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  // Link ~/.pi into the clean home so the pi-coding-agent's session store
  // remains reachable. Without this link the dev server reads sessions from
  // an empty `cleanHome/.pi/agent/sessions/` and shows a blank list.
  // Junctions (mklink /J) work without admin or developer-mode on Windows.
  const realHome = originalHome || originalUserProfile;
  if (realHome) {
    linkAgentDir(realHome, cleanHome);
  }

  try {
    // Point HOME/USERPROFILE at a clean dir so webpack's filesystem glob walks
    // an empty home instead of the real one (which contains shell symlinks).
    process.env.HOME = cleanHome;
    process.env.USERPROFILE = cleanHome;

    const resolved = resolveCommand(cmd);
    const finalArgs = [...resolved.args, ...args];
    const child = spawn(resolved.file, finalArgs, {
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code, signal) => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      try { rmSync(cleanHome, { recursive: true, force: true }); } catch { /* ignore */ }
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
  } catch (error) {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    try { rmSync(cleanHome, { recursive: true, force: true }); } catch { /* ignore */ }
    console.error("with-clean-home.js failed:", error);
    process.exit(1);
  }
}

function linkAgentDir(realHome, cleanHome) {
  const { symlinkSync } = require("node:fs");
  const source = join(realHome, ".pi");
  if (!existsSync(source)) return;
  const target = join(cleanHome, ".pi");
  try {
    // Junctions don't need admin or developer mode on Windows. On non-Win
    // platforms symlink type "dir" works without elevation.
    symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    // Don't block the dev server if the link fails — just warn.
    console.warn(`with-clean-home.js: could not link ${source} -> ${target}: ${error.message}`);
  }
}