"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const CLI_OPTIONS = {
  port: { type: "string", short: "p" },
  hostname: { type: "string", short: "H" },
  "no-open": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const COMMANDS = new Set(["foreground", "start", "stop", "status", "restart", "reload", "update"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function getHelpText() {
  return `Usage: pi-web [command] [options]

Start the Pi Web UI server.

Commands:
  start                      Start a background service (macOS only)
  stop                       Stop and unload the background service (macOS only)
  status                     Report background service status (macOS only)
  restart, reload            Restart the background service (macOS only)
  update <directory>         Build and globally install from a source directory

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or PI_WEB_HOSTNAME)
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_HOSTNAME            Default hostname when --hostname is omitted
  PI_WEB_NO_OPEN             Set to 1/true/yes/on to disable browser open
  PI_WEB_PASSWORD            Enable browser password login and API Basic Auth
  PI_WEB_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated
`;
}

function parseCliArguments(args = process.argv.slice(2), env = process.env) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${message}\nUse --help to see available options.`);
    err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw err;
  }

  if (values.help) return { command: "foreground", help: true };
  const command = positionals[0] ?? "foreground";
  const sourceDir = positionals[1];
  if (!COMMANDS.has(command) || (command === "update" ? positionals.length !== 2 : positionals.length > 1)) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(" ")}\nUse --help to see available options.`,
    );
  }

  return {
    command,
    ...(sourceDir ? { sourceDir } : {}),
    help: false,
    port: normalizePort(values.port ?? env.PORT ?? "30141"),
    hostname: values.hostname ?? env.PI_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !values["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const options = parseCliArguments(args, env);
  if (options.command !== "foreground") {
    throw new Error(
      `Unexpected argument(s): ${options.command}\nUse --help to see available options.`,
    );
  }
  const launchOptions = { ...options };
  delete launchOptions.command;
  return launchOptions;
}

module.exports = { parseCliArguments, parseLaunchOptions, getHelpText };
