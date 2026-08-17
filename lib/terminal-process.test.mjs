import assert from "node:assert/strict";
import test from "node:test";

import { buildTerminalSpawnConfig } from "./terminal-process.ts";

test("terminal process uses a fixed shell without startup files", () => {
  const config = buildTerminalSpawnConfig("/repo", 100, 30, { HOME: "/home/user", PATH: "/bin" }, "linux");
  assert.ok(config.file === "/bin/bash" || config.file === "/bin/sh");
  if (config.file === "/bin/bash") assert.deepEqual(config.args, ["--noprofile", "--norc", "-i"]);
  assert.equal(config.options.cwd, "/repo");
  assert.equal(config.options.cols, 100);
  assert.equal(config.options.rows, 30);
});

test("terminal process does not inherit server secrets or injection variables", () => {
  const separator = process.platform === "win32" ? ";" : ":";
  const safePaths = process.platform === "win32" ? ["C:\\Windows", "C:\\Windows\\System32"] : ["/usr/bin", "/bin"];
  const config = buildTerminalSpawnConfig("/repo", 80, 24, {
    HOME: "/home/user",
    PATH: `${safePaths[0]}${separator}.${separator}${safePaths[1]}`,
    LANG: "en_US.UTF-8",
    PI_WEB_PASSWORD: "do-not-leak",
    OPENAI_API_KEY: "do-not-leak",
    NODE_OPTIONS: "--require /tmp/inject.js",
    BASH_ENV: "/tmp/inject.sh",
    ENV: "/tmp/inject.sh",
    PROMPT_COMMAND: "bad-command",
  }, "linux");
  const env = config.options.env;

  assert.equal(env?.HOME, "/home/user");
  assert.equal(env?.PATH, safePaths.join(separator));
  assert.equal(env?.TERM, "xterm-256color");
  assert.equal(env?.PWD, "/repo");
  for (const key of ["PI_WEB_PASSWORD", "OPENAI_API_KEY", "NODE_OPTIONS", "BASH_ENV", "ENV", "PROMPT_COMMAND"]) {
    assert.equal(env?.[key], undefined, key);
  }
});
