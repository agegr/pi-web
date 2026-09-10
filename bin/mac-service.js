"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const SERVICE_LABEL = "com.agegr.pi-web";
const OWNERSHIP_MARKER = "<!-- Managed by @agegr/pi-web. Do not edit. -->";

function assertSupportedPlatform(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error(
      `Pi Web service commands are only supported on macOS (darwin); plain pi-web foreground startup is available on ${platform}.`,
    );
  }
}

function getServicePaths(homeDir = os.homedir()) {
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logDir = path.join(homeDir, "Library", "Logs", "Pi Web");
  return {
    launchAgentsDir,
    plistPath: path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`),
    logDir,
    stdoutPath: path.join(logDir, "pi-web.log"),
    stderrPath: path.join(logDir, "pi-web.error.log"),
  };
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

function serializePlist({
  label = SERVICE_LABEL,
  programArguments,
  workingDirectory,
  environmentVariables = {},
  stdoutPath,
  stderrPath,
}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    OWNERSHIP_MARKER,
    "<plist version=\"1.0\">",
    "<dict>",
    `  <key>Label</key>\n  <string>${xmlEscape(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`),
    "  </array>",
    `  <key>WorkingDirectory</key>\n  <string>${xmlEscape(workingDirectory)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...Object.entries(environmentVariables)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, value]) => [
        `    <key>${xmlEscape(key)}</key>`,
        `    <string>${xmlEscape(value)}</string>`,
      ]),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    `  <key>StandardOutPath</key>\n  <string>${xmlEscape(stdoutPath)}</string>`,
    `  <key>StandardErrorPath</key>\n  <string>${xmlEscape(stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ];
  return lines.join("\n");
}

function createServicePlist({
  nodePath = process.execPath,
  scriptPath,
  packageDir,
  port,
  hostname,
  openBrowser,
  environment = process.env,
  paths = getServicePaths(),
}) {
  const programArguments = [
    nodePath,
    scriptPath,
    "--port",
    port,
    "--hostname",
    hostname,
  ];
  if (!openBrowser) programArguments.push("--no-open");

  return serializePlist({
    programArguments,
    workingDirectory: packageDir,
    environmentVariables: environment,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
  });
}

function isManagedPlist(contents) {
  return contents.includes(OWNERSHIP_MARKER)
    && contents.includes(`<key>Label</key>\n  <string>${SERVICE_LABEL}</string>`);
}

function readExistingPlist(plistPath) {
  try {
    const contents = fs.readFileSync(plistPath, "utf8");
    if (!isManagedPlist(contents)) {
      throw new Error(
        `Refusing to overwrite ${plistPath}: it is not a Pi Web LaunchAgent.`,
      );
    }
    return contents;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function writePlist(plistPath, contents) {
  const existing = readExistingPlist(plistPath);
  if (existing === contents) return false;

  fs.mkdirSync(path.dirname(plistPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${plistPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, plistPath);
    fs.chmodSync(plistPath, 0o600);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(`Could not write Pi Web LaunchAgent ${plistPath}: ${error.message}`);
  }
  return true;
}

function defaultLaunchctl(args, environment) {
  try {
    return {
      status: 0,
      stdout: execFileSync("launchctl", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: environment,
      }),
    };
  } catch (error) {
    if (typeof error.status === "number") {
      return {
        status: error.status,
        stdout: error.stdout?.toString() ?? "",
        stderr: error.stderr?.toString() ?? "",
      };
    }
    throw new Error(`Could not run launchctl: ${error.message}`);
  }
}

function getServiceContext({ platform = process.platform, uid = process.getuid?.() } = {}) {
  assertSupportedPlatform(platform);
  if (!Number.isInteger(uid)) throw new Error("Could not determine the current macOS user id.");
  const domain = `gui/${uid}`;
  return { domain, serviceTarget: `${domain}/${SERVICE_LABEL}` };
}

function inspectService(runLaunchctl, serviceTarget) {
  const result = runLaunchctl(["print", serviceTarget]);
  if (result.status === 0) {
    return {
      loaded: true,
      running: /(?:^|\n)\s*state\s*=\s*running\s*(?:\n|$)/.test(result.stdout),
    };
  }
  if (typeof result.status === "number") return { loaded: false, running: false };
  throw new Error("launchctl print returned no status.");
}

function requireLaunchctlSuccess(result, args) {
  if (result.status === 0) return;
  const detail = result.stderr?.trim() || result.stdout?.trim();
  throw new Error(
    `launchctl ${args.join(" ")} failed${detail ? `: ${detail}` : ` (exit code ${result.status})`}.`,
  );
}

function makeOptions(options) {
  const paths = options.paths ?? getServicePaths(options.homeDir);
  const context = getServiceContext(options);
  const runLaunchctl = options.runLaunchctl
    ?? ((args) => defaultLaunchctl(args, options.environment ?? process.env));
  return { ...options, paths, ...context, runLaunchctl };
}

function startService(options) {
  const service = makeOptions(options);
  fs.mkdirSync(service.paths.logDir, { recursive: true, mode: 0o700 });
  const plist = createServicePlist({ ...options, paths: service.paths });
  const changed = writePlist(service.paths.plistPath, plist);
  const state = inspectService(service.runLaunchctl, service.serviceTarget);

  if (state.loaded && !changed && state.running) {
    return { message: "Pi Web service is already running.", paths: service.paths };
  }
  if (state.loaded && changed) {
    requireLaunchctlSuccess(
      service.runLaunchctl(["bootout", service.serviceTarget]),
      ["bootout", service.serviceTarget],
    );
  }

  const action = state.loaded && !changed ? "kickstart" : "bootstrap";
  const args = action === "kickstart"
    ? ["kickstart", "-k", service.serviceTarget]
    : ["bootstrap", service.domain, service.paths.plistPath];
  requireLaunchctlSuccess(service.runLaunchctl(args), args);
  return { message: "Pi Web service started.", paths: service.paths };
}

function stopService(options) {
  const service = makeOptions(options);
  if (fs.existsSync(service.paths.plistPath)) readExistingPlist(service.paths.plistPath);
  const state = inspectService(service.runLaunchctl, service.serviceTarget);
  if (!state.loaded) {
    return { message: "Pi Web service is not running.", paths: service.paths };
  }

  const args = ["bootout", service.serviceTarget];
  requireLaunchctlSuccess(service.runLaunchctl(args), args);
  return { message: "Pi Web service stopped.", paths: service.paths };
}

function restartService(options) {
  stopService(options);
  return startService(options);
}

function statusService(options) {
  const service = makeOptions(options);
  if (fs.existsSync(service.paths.plistPath)) readExistingPlist(service.paths.plistPath);
  const state = inspectService(service.runLaunchctl, service.serviceTarget);
  const status = state.running
    ? "running"
    : state.loaded
      ? "not running (loaded but inactive)"
      : "not running (not loaded)";
  return {
    message: `Pi Web service: ${status}\nLaunchAgent: ${service.paths.plistPath}\nLogs: ${service.paths.logDir}`,
    paths: service.paths,
    ...state,
  };
}

function runServiceCommand(command, options) {
  if (command === "start") return startService(options);
  if (command === "stop") return stopService(options);
  if (command === "status") return statusService(options);
  if (command === "restart" || command === "reload") return restartService(options);
  throw new Error(`Unknown Pi Web service command: ${command}`);
}

module.exports = {
  OWNERSHIP_MARKER,
  SERVICE_LABEL,
  assertSupportedPlatform,
  createServicePlist,
  getServicePaths,
  isManagedPlist,
  restartService,
  runServiceCommand,
  startService,
  statusService,
  stopService,
  serializePlist,
};
