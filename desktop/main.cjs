"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const webPartition = "persist:pi-web-web";
const isDev = process.argv.includes("--dev");
let mainWindow;
let server;
let serverUrl;
let quitting = false;

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPiWebUrl(value) {
  try {
    return new URL(value).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function getNextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [appRoot] });
  } catch {
    const nextPackage = require.resolve("next/package.json", { paths: [appRoot] });
    return path.join(path.dirname(nextPackage), "dist", "bin", "next");
  }
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(url, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 45_000;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Pi Web server exited before it became ready (${code ?? signal ?? "unknown"}).`));
    };
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          cleanup();
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error("Timed out waiting for the Pi Web server."));
        return;
      }
      timer = setTimeout(attempt, 150);
    };

    child.once("exit", onExit);
    attempt();
  });
}

async function startServer() {
  const port = await getAvailablePort();
  const nextBin = getNextBin();
  const args = [nextBin, isDev ? "dev" : "start", "-H", "127.0.0.1", "-p", String(port)];

  // process.execPath is Electron rather than Node. ELECTRON_RUN_AS_NODE makes
  // this child run Next with Electron's bundled Node runtime instead of opening
  // a second Electron app.
  server = spawn(process.execPath, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PI_WEB_HOSTNAME: "127.0.0.1",
      // Next permits only one dev server per dist directory. Keep the Electron
      // preview isolated from the browser dev server's .next/dev lock.
      ...(isDev ? { PI_WEB_NEXT_DIST_DIR: ".next-electron-dev" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, server);
  serverUrl = url;
  server.once("exit", (code, signal) => {
    if (quitting) return;
    const detail = `Pi Web server stopped unexpectedly (${code ?? signal ?? "unknown"}).`;
    void dialog.showMessageBox({ type: "error", title: "Pi Web stopped", message: detail }).finally(() => app.quit());
  });
  return url;
}

function stopServer() {
  if (!server || server.exitCode !== null || server.killed) return;
  server.kill("SIGTERM");
}

function secureWebviewPreferences(webPreferences, params, event) {
  if (!isWebUrl(params.src)) {
    event.preventDefault();
    return;
  }

  // Guest pages are untrusted remote documents. They never receive Node or a
  // preload bridge, while their persistent partition retains their own login.
  delete webPreferences.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  params.partition = webPartition;
}

function createMainWindow(serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 900,
    minHeight: 620,
    title: "Pi Web",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  // The Pi Web renderer itself must remain on its local server. External links
  // (including the WebViewer's "open externally" action) use the user's normal browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isPiWebUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = undefined; });
  void mainWindow.loadURL(serverUrl);
}

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;

  // OAuth providers sometimes use a popup. Keep it in Electron so it shares
  // the guest's cookie partition instead of handing it to an unrelated browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (!isWebUrl(url)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: webPartition,
        },
      },
    };
  });
});

app.whenReady().then(async () => {
  ipcMain.handle("pi-web:select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // No permission is granted to arbitrary pages embedded in the native panel.
  session.fromPartition(webPartition).setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "window") {
      contents.on("will-attach-webview", (event, webPreferences, params) => {
        secureWebviewPreferences(webPreferences, params, event);
      });
    }
  });

  try {
    const serverUrl = await startServer();
    createMainWindow(serverUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({ type: "error", title: "Pi Web failed to start", message });
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  stopServer();
});

app.on("activate", () => {
  if (!mainWindow && serverUrl) createMainWindow(serverUrl);
});

process.on("SIGTERM", () => {
  if (!quitting) app.quit();
});
