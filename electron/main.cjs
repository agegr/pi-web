const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

let mainWindow = null;
let serverProcess = null;
let serverConfig = null;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--portable") {
      args.portable = true;
    } else if (arg === "--agent-dir" && argv[i + 1]) {
      args.agentDir = argv[++i];
    } else if (arg.startsWith("--agent-dir=")) {
      args.agentDir = arg.slice("--agent-dir=".length);
    } else if ((arg === "--port" || arg === "-p") && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (arg.startsWith("--port=")) {
      args.port = Number(arg.slice("--port=".length));
    } else if ((arg === "--hostname" || arg === "-H") && argv[i + 1]) {
      args.hostname = argv[++i];
    } else if (arg.startsWith("--hostname=")) {
      args.hostname = arg.slice("--hostname=".length);
    }
  }
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
}

function getDesktopConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function resolveMaybeRelative(input, baseDir) {
  if (!input) return input;
  const expanded = input === "~" ? app.getPath("home") : input.startsWith("~/") ? path.join(app.getPath("home"), input.slice(2)) : input;
  return path.resolve(baseDir, expanded);
}

function loadConfig() {
  const cli = parseArgs(process.argv.slice(1));
  const stored = readJson(getDesktopConfigPath());
  const exeDir = path.dirname(process.execPath);
  const portable = Boolean(cli.portable ?? stored.portable);
  const defaultAgentDir = portable
    ? path.join(exeDir, "data", "agent")
    : path.join(app.getPath("userData"), "agent");

  return {
    hostname: cli.hostname || stored.hostname || process.env.HOSTNAME || "127.0.0.1",
    port: Number(cli.port || stored.port || process.env.PORT || 30141),
    agentDir: resolveMaybeRelative(cli.agentDir || stored.agentDir || process.env.PI_CODING_AGENT_DIR || defaultAgentDir, exeDir),
    portable,
  };
}

function getMiniBashBin(appRoot) {
  return path.join(appRoot, "vendor", "mini-bash", "usr", "bin");
}

function getMiniBashPath(appRoot) {
  return path.join(getMiniBashBin(appRoot), process.platform === "win32" ? "bash.exe" : "bash");
}

function prependPath(env, dir) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  const current = env[pathKey] || "";
  const parts = current.split(path.delimiter).filter(Boolean);
  const normalizedDir = path.normalize(dir).toLowerCase();
  const filtered = parts.filter((p) => path.normalize(p).toLowerCase() !== normalizedDir);
  return { ...env, [pathKey]: [dir, ...filtered].join(path.delimiter) };
}

function ensureDesktopAgentSettings(agentDir, miniBashPath) {
  if (process.platform !== "win32" || !fs.existsSync(miniBashPath)) return;
  fs.mkdirSync(agentDir, { recursive: true });
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = readJson(settingsPath);
  const currentShellPath = typeof settings.shellPath === "string" ? settings.shellPath : "";
  if (!currentShellPath || !fs.existsSync(currentShellPath)) {
    settings.shellPath = miniBashPath;
    writeJson(settingsPath, settings);
  }
}

function buildServerEnv(config, appRoot) {
  let env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(config.port),
    HOSTNAME: config.hostname,
    PI_CODING_AGENT_DIR: config.agentDir,
  };

  const miniBashBin = getMiniBashBin(appRoot);
  if (process.platform === "win32" && fs.existsSync(path.join(miniBashBin, "bash.exe"))) {
    env = prependPath(env, miniBashBin);
    env.MSYSTEM = env.MSYSTEM || "MINGW64";
    env.CHERE_INVOKING = env.CHERE_INVOKING || "1";
    env.MSYS2_PATH_TYPE = env.MSYS2_PATH_TYPE || "inherit";
  }
  return env;
}

function resolveNextBin(appRoot) {
  return require.resolve("next/dist/bin/next", { paths: [appRoot] });
}

function waitForPort(port, host, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", (error) => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(error);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function startServer(config) {
  const appRoot = getAppRoot();
  const nextBin = resolveNextBin(appRoot);
  const miniBashPath = getMiniBashPath(appRoot);
  fs.mkdirSync(config.agentDir, { recursive: true });
  ensureDesktopAgentSettings(config.agentDir, miniBashPath);
  const env = buildServerEnv(config, appRoot);

  console.log(`[pi-web desktop] app root: ${appRoot}`);
  console.log(`[pi-web desktop] agent dir: ${config.agentDir}`);
  if (process.platform === "win32" && fs.existsSync(miniBashPath)) {
    console.log(`[pi-web desktop] bundled mini-bash: ${miniBashPath}`);
  }

  serverProcess = spawn(process.execPath, [nextBin, "start", "-p", String(config.port), "-H", config.hostname], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.on("exit", (code, signal) => {
    console.log(`[pi-web desktop] server exited code=${code} signal=${signal}`);
    if (serverProcess && mainWindow) {
      dialog.showErrorBox("Pi Web server stopped", `The local server exited with code ${code ?? signal ?? "unknown"}.`);
    }
  });

  await waitForPort(config.port, config.hostname);
}

function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Agent Data Directory",
          click: () => serverConfig?.agentDir && shell.openPath(serverConfig.agentDir),
        },
        {
          label: "Open App Directory",
          click: () => shell.openPath(getAppRoot()),
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  serverConfig = loadConfig();
  await startServer(serverConfig);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://${serverConfig.hostname}:${serverConfig.port}`);
}

app.whenReady().then(() => {
  createMenu();
  createWindow().catch((error) => {
    console.error(error);
    dialog.showErrorBox("Failed to start Pi Web", error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => console.error(error));
  }
});

app.on("before-quit", () => {
  stopServer();
});
