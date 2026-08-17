import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { formatHelp, parseLaunchOptions } = require("../bin/pi-web-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
    help: false,
    offline: false,
    agentOptions: {},
  });
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy PI_WEB_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false PI_WEB_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
      help: false,
      offline: false,
      agentOptions: {},
    },
  );
});

test("forwards Pi model and tool options", () => {
  const result = parseLaunchOptions([
    "--provider", "anthropic",
    "--model", "claude-sonnet:high",
    "--thinking", "low",
    "--models", "anthropic/*:high,openai/gpt-*",
    "--api-key", "runtime-key",
    "-t", "read,bash",
    "-xt", "write,edit",
  ], {});

  assert.deepEqual(result.agentOptions, {
    provider: "anthropic",
    model: "claude-sonnet:high",
    thinking: "low",
    models: ["anthropic/*:high", "openai/gpt-*"],
    apiKey: "runtime-key",
    tools: ["read", "bash"],
    excludeTools: ["write", "edit"],
  });
});

test("supports Pi multi-character aliases", () => {
  assert.deepEqual(parseLaunchOptions(["-ns", "-nc", "-nt"], {}).agentOptions, {
    noTools: "all",
    noSkills: true,
    noContextFiles: true,
  });
  assert.equal(parseLaunchOptions(["-nbt"], {}).agentOptions.noTools, "builtin");
});

test("forwards repeatable resources and resolves local paths from the launch cwd", () => {
  const result = parseLaunchOptions([
    "-e", "./extensions/local.ts",
    "--extension", "npm:@scope/tools",
    "--skill", "./skills/review/SKILL.md",
    "--prompt-template", "prompts/review.md",
    "--theme", "https://example.com/theme.json",
    "--append-system-prompt", "first",
    "--append-system-prompt", "second",
    "--no-extensions",
    "--no-prompt-templates",
    "--no-themes",
    "--system-prompt", "minimal",
  ], {}, "/workspace");

  assert.deepEqual(result.agentOptions, {
    additionalExtensionPaths: ["/workspace/extensions/local.ts", "npm:@scope/tools"],
    additionalSkillPaths: ["/workspace/skills/review/SKILL.md"],
    additionalPromptTemplatePaths: ["/workspace/prompts/review.md"],
    additionalThemePaths: ["https://example.com/theme.json"],
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: "minimal",
    appendSystemPrompt: ["first", "second"],
  });
});

test("supports help and offline mode", () => {
  const result = parseLaunchOptions(["--help", "--offline"], {});
  assert.equal(result.help, true);
  assert.equal(result.offline, true);
  assert.match(formatHelp(), /--no-skills/);
  assert.match(formatHelp(), /--no-context-files/);
  assert.match(formatHelp(), /--exclude-tools/);
});

test("rejects invalid or unsupported options instead of silently ignoring them", () => {
  assert.throws(() => parseLaunchOptions(["--unknown"], {}), /Unknown option/);
  assert.throws(() => parseLaunchOptions(["--provider", "anthropic"], {}), /requires --model/);
  assert.throws(() => parseLaunchOptions(["--thinking", "extreme"], {}), /Invalid thinking level/);
  assert.throws(() => parseLaunchOptions(["--models", ","], {}), /requires at least one value/);
  assert.throws(() => parseLaunchOptions(["--no-tools", "--no-builtin-tools"], {}), /cannot be used together/);
});

test("rejects port values that could inject cmd arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["-p", "30141&whoami"], {}),
    /Port must be a non-negative integer/,
  );
  assert.throws(
    () => parseLaunchOptions([], { PORT: "30141&whoami" }),
    /Port must be a non-negative integer/,
  );
});

test("supports PI_WEB_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { PI_WEB_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
