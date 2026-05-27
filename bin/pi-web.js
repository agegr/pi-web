#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

function readUserConfig() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return {};
  const configPath = path.join(home, ".pi", "web.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    console.warn(`Ignoring invalid config: ${configPath}`);
    return {};
  }
}

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readUserEnv() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return {};
  const envPath = path.join(home, ".pi", "web.env");
  if (!fs.existsSync(envPath)) return {};
  try {
    return parseEnvFile(fs.readFileSync(envPath, "utf8"));
  } catch {
    console.warn(`Ignoring invalid config: ${envPath}`);
    return {};
  }
}

function boolConfig(value) {
  if (typeof value === "boolean") return value ? "1" : "0";
  return undefined;
}

function applyUserConfigToEnv(config, envConfig) {
  if (!process.env.WEB_TOKEN) {
    if (envConfig.WEB_TOKEN) process.env.WEB_TOKEN = envConfig.WEB_TOKEN;
    else if (typeof config.webToken === "string") process.env.WEB_TOKEN = config.webToken;
  }
  if (!process.env.PI_WEB_REMOTE) {
    if (envConfig.PI_WEB_REMOTE) process.env.PI_WEB_REMOTE = envConfig.PI_WEB_REMOTE;
    else {
      const remote = boolConfig(config.remote);
      if (remote) process.env.PI_WEB_REMOTE = remote;
    }
  }
  if (!process.env.PI_WEB_COOKIE_SECURE) {
    if (envConfig.PI_WEB_COOKIE_SECURE) process.env.PI_WEB_COOKIE_SECURE = envConfig.PI_WEB_COOKIE_SECURE;
    else {
      const cookieSecure = boolConfig(config.cookieSecure);
      if (cookieSecure) process.env.PI_WEB_COOKIE_SECURE = cookieSecure;
    }
  }
  if (!process.env.PI_WEB_HOSTNAME && envConfig.PI_WEB_HOSTNAME) {
    process.env.PI_WEB_HOSTNAME = envConfig.PI_WEB_HOSTNAME;
  }
}

const userEnv = readUserEnv();
const userConfig = readUserConfig();
applyUserConfigToEnv(userConfig, userEnv);

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
  },
  strict: false,
});

const remoteEnabled = /^(1|true|yes|on)$/i.test(process.env.PI_WEB_REMOTE ?? "");
const port = cliArgs.port ?? process.env.PORT ?? "30141";
const hostname = cliArgs.hostname ?? process.env.PI_WEB_HOSTNAME ?? (remoteEnabled ? "0.0.0.0" : null);

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const nextArgs = ["start", "-p", port];
if (hostname) nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env },
});

let browserOpened = false;
const browserHost = !hostname || hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
const url = `http://${browserHost}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
