import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getHelpText, parseLaunchOptions } = require("../bin/pi-web-options.js");
const cliPath = fileURLToPath(new URL("../bin/pi-web.js", import.meta.url));

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    help: false,
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
  });
});

test("supports --help and -h without starting the server", () => {
  assert.deepEqual(parseLaunchOptions(["--help"], {}), { help: true });
  assert.deepEqual(parseLaunchOptions(["-h"], {}), { help: true });
  assert.match(getHelpText(), /Usage: pi-web/);
  assert.match(getHelpText(), /--port/);
  assert.match(getHelpText(), /--hostname/);
  assert.match(getHelpText(), /--no-open/);
  assert.match(getHelpText(), /-v, --version/);
  assert.match(getHelpText(), /PI_WEB_SKIP_VERSION_CHECK/);
  assert.match(getHelpText(), /PI_WEB_IDLE_TIMEOUT_MS/);
});

test("supports --version and -v without validating port or hostname", () => {
  assert.deepEqual(parseLaunchOptions(["--version"], {}), { version: true });
  assert.deepEqual(parseLaunchOptions(["-v"], {}), { version: true });
  assert.deepEqual(
    parseLaunchOptions(["--version", "--port", "not-a-port"], {}),
    { version: true },
  );
});

test("lets --help win when combined with --version", () => {
  assert.deepEqual(parseLaunchOptions(["--help", "--version"], {}), { help: true });
  assert.deepEqual(parseLaunchOptions(["--version", "--help"], {}), { help: true });
});

test("CLI prints the package version for --version and -v without build artifacts", () => {
  const pkg = require("../package.json");
  // Run from a copy that has no .next, so the test fails if --version is ever
  // handled below the build-artifact check.
  const root = mkdtempSync(join(tmpdir(), "pi-web-version-"));
  try {
    cpSync(fileURLToPath(new URL("../bin", import.meta.url)), join(root, "bin"), {
      recursive: true,
    });
    cpSync(fileURLToPath(new URL("../package.json", import.meta.url)), join(root, "package.json"));
    assert.equal(existsSync(join(root, ".next")), false);
    for (const flag of ["--version", "-v"]) {
      const result = spawnSync(process.execPath, [join(root, "bin", "pi-web.js"), flag], {
        encoding: "utf8",
        cwd: root,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `${pkg.version}\n`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unknown options with a help hint", () => {
  assert.throws(
    () => parseLaunchOptions(["--unknown-flag"], {}),
    /Use --help to see available options/,
  );
});

test("rejects unexpected positional arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["start"], {}),
    /Unexpected argument/,
  );
});

test("CLI writes help and parse errors before exiting", () => {
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: pi-web/);

  const invalid = spawnSync(process.execPath, [cliPath, "--unknown-flag"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use --help to see available options/);
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
      help: false,
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
    },
  );
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
