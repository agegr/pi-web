#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { request } = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = 30141;
const url = `http://${host}:${port}`;
const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
const proxyBootstrap = path.join(__dirname, "pi-web-proxy-bootstrap.cjs");

if (!fs.existsSync(path.join(projectDir, ".next"))) {
  console.error("Pi Web 尚未构建，找不到 .next 文件夹。请先在项目目录运行 npm run build。\n");
  process.exit(1);
}

function isReady() {
  return new Promise((resolve) => {
    const req = request(url, { method: "HEAD", timeout: 800 }, (res) => {
      res.resume();
      resolve((res.statusCode || 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function openBrowser() {
  const opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
    stdio: "ignore",
    detached: true,
  });
  opener.unref();
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

const child = spawn(process.execPath, ["--require", proxyBootstrap, nextBin, "start", "-p", String(port), "-H", host], {
  cwd: projectDir,
  stdio: "inherit",
  env: { ...process.env, PI_WEB_HOSTNAME: host, PI_WEB_NO_OPEN: "1" },
});

let shuttingDown = false;
let browserOpened = false;

async function waitForServer() {
  for (let attempt = 0; attempt < 120 && !shuttingDown; attempt += 1) {
    if (await isReady()) {
      openBrowser();
      browserOpened = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!browserOpened && !shuttingDown) {
    console.error(`等待 Pi Web 启动超时，请检查上面的终端错误信息。地址：${url}`);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProcess(child);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
child.once("exit", (code, signal) => {
  if (!shuttingDown && (code !== 0 || signal)) {
    console.error(`Pi Web 已退出（code=${code ?? "-"}, signal=${signal ?? "-"}）。`);
  }
  process.exit(code ?? 1);
});
child.once("error", (error) => {
  console.error(`无法启动 Pi Web：${error.message}`);
  process.exit(1);
});

waitForServer().catch((error) => {
  console.error(`启动 Pi Web 失败：${error.message}`);
  shutdown();
});
