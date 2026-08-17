"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const REMOTE_RESOURCE_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:"];
const LONG_SHORT_ALIASES = new Map([
  ["-xt", "--exclude-tools"],
  ["-nbt", "--no-builtin-tools"],
  ["-nt", "--no-tools"],
  ["-ns", "--no-skills"],
  ["-nc", "--no-context-files"],
]);

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

function expandLongShortAliases(args) {
  return args.map((arg) => LONG_SHORT_ALIASES.get(arg) ?? arg);
}

function splitCommaSeparated(value, optionName) {
  if (value === undefined) return undefined;
  const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${optionName} requires at least one value.`);
  return values;
}

function isLocalResource(value) {
  const trimmed = value.trim();
  return !REMOTE_RESOURCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function resolveResourcePaths(values, cwd) {
  return values?.map((value) => isLocalResource(value) ? path.resolve(cwd, value) : value);
}

function assignDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const { values: cliArgs } = parseArgs({
    args: expandLongShortAliases(args),
    options: {
      // Pi Web server options.
      port:                    { type: "string", short: "p" },
      hostname:                { type: "string", short: "H" },
      "no-open":               { type: "boolean" },
      help:                    { type: "boolean", short: "h" },
      offline:                 { type: "boolean" },

      // Pi model and tool options that are meaningful to the Web runtime.
      provider:                { type: "string" },
      model:                   { type: "string" },
      thinking:                { type: "string" },
      models:                  { type: "string" },
      "api-key":               { type: "string" },
      tools:                   { type: "string", short: "t" },
      "exclude-tools":         { type: "string" },
      "no-builtin-tools":      { type: "boolean" },
      "no-tools":              { type: "boolean" },

      // Pi resource-loader options.
      extension:               { type: "string", short: "e", multiple: true },
      "no-extensions":         { type: "boolean" },
      skill:                   { type: "string", multiple: true },
      "no-skills":             { type: "boolean" },
      "prompt-template":       { type: "string", multiple: true },
      "no-prompt-templates":   { type: "boolean" },
      theme:                   { type: "string", multiple: true },
      "no-themes":             { type: "boolean" },
      "no-context-files":      { type: "boolean" },
      "system-prompt":         { type: "string" },
      "append-system-prompt":  { type: "string", multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });

  if (cliArgs.provider && !cliArgs.model) {
    throw new Error("--provider requires --model.");
  }
  if (cliArgs["api-key"] && !cliArgs.model) {
    throw new Error("--api-key requires --model.");
  }
  if (cliArgs.thinking && !THINKING_LEVELS.has(cliArgs.thinking)) {
    throw new Error(`Invalid thinking level: ${cliArgs.thinking}.`);
  }
  if (cliArgs["no-tools"] && cliArgs["no-builtin-tools"]) {
    throw new Error("--no-tools and --no-builtin-tools cannot be used together.");
  }

  const agentOptions = {};
  assignDefined(agentOptions, "provider", cliArgs.provider);
  assignDefined(agentOptions, "model", cliArgs.model);
  assignDefined(agentOptions, "thinking", cliArgs.thinking);
  assignDefined(agentOptions, "models", splitCommaSeparated(cliArgs.models, "--models"));
  assignDefined(agentOptions, "apiKey", cliArgs["api-key"]);
  assignDefined(agentOptions, "tools", splitCommaSeparated(cliArgs.tools, "--tools"));
  assignDefined(agentOptions, "excludeTools", splitCommaSeparated(cliArgs["exclude-tools"], "--exclude-tools"));
  if (cliArgs["no-tools"]) agentOptions.noTools = "all";
  if (cliArgs["no-builtin-tools"]) agentOptions.noTools = "builtin";

  assignDefined(agentOptions, "additionalExtensionPaths", resolveResourcePaths(cliArgs.extension, cwd));
  assignDefined(agentOptions, "additionalSkillPaths", resolveResourcePaths(cliArgs.skill, cwd));
  assignDefined(agentOptions, "additionalPromptTemplatePaths", resolveResourcePaths(cliArgs["prompt-template"], cwd));
  assignDefined(agentOptions, "additionalThemePaths", resolveResourcePaths(cliArgs.theme, cwd));
  if (cliArgs["no-extensions"]) agentOptions.noExtensions = true;
  if (cliArgs["no-skills"]) agentOptions.noSkills = true;
  if (cliArgs["no-prompt-templates"]) agentOptions.noPromptTemplates = true;
  if (cliArgs["no-themes"]) agentOptions.noThemes = true;
  if (cliArgs["no-context-files"]) agentOptions.noContextFiles = true;
  assignDefined(agentOptions, "systemPrompt", cliArgs["system-prompt"]);
  assignDefined(agentOptions, "appendSystemPrompt", cliArgs["append-system-prompt"]);

  return {
    port: normalizePort(cliArgs.port ?? env.PORT ?? "30141"),
    hostname: cliArgs.hostname ?? env.PI_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
    help: cliArgs.help ?? false,
    offline: cliArgs.offline ?? isEnabled(env.PI_OFFLINE),
    agentOptions,
  };
}

function formatHelp() {
  return `Usage: pi-web [options]

Pi Web server options:
  -p, --port <port>               Server port (default: 30141)
  -H, --hostname <host>           Bind hostname (default: 127.0.0.1)
      --no-open                   Do not open a browser automatically
  -h, --help                      Show this help
      --offline                   Disable startup network operations

Agent model options (server defaults; explicit Web selections take precedence):
      --provider <name>           Model provider (requires --model)
      --model <pattern>           Model ID/pattern, optionally provider/model:thinking
      --thinking <level>          off|minimal|low|medium|high|xhigh|max
      --models <patterns>         Comma-separated model scope patterns
      --api-key <key>             Runtime API key for the selected model provider

Agent tool options:
  -t, --tools <names>             Comma-separated tool allowlist
  -xt, --exclude-tools <names>    Comma-separated tool denylist
  -nbt, --no-builtin-tools        Disable built-in tools, keep extension tools
  -nt, --no-tools                 Disable all tools

Agent resource options:
  -e, --extension <source>        Load an extension (repeatable)
      --no-extensions             Disable extension discovery
      --skill <path>              Load a skill (repeatable)
  -ns, --no-skills                Disable skill discovery
      --prompt-template <path>    Load a prompt template (repeatable)
      --no-prompt-templates       Disable prompt-template discovery
      --theme <path>              Load an Agent theme resource (repeatable)
      --no-themes                 Disable Agent theme discovery
  -nc, --no-context-files         Disable AGENTS.md/CLAUDE.md discovery
      --system-prompt <text>      Replace the default Agent system prompt
      --append-system-prompt <t>  Append to the Agent system prompt (repeatable)

Pi TUI/session flags such as --print, --continue, --resume, --session,
--fork, and --no-session do not apply to Pi Web's multi-session interface.`;
}

module.exports = { formatHelp, parseLaunchOptions };
