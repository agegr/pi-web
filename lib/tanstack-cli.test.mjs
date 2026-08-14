import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const ROOT = process.cwd();
const cliSource = await readFile(new URL("../bin/pi-web.js", import.meta.url), "utf8");

test("the CLI source resolves the Nitro server entry without shell or Next", () => {
  assert.match(cliSource, /\.output["']?[,)]|\.output/, "must resolve .output/server/index.mjs");
  assert.match(cliSource, /server[\"'`]?[\s]*,[\s]*["'`]index\.mjs|index\.mjs/, "must resolve index.mjs");
  assert.doesNotMatch(cliSource, /next\/dist\/bin\/next/);
  assert.doesNotMatch(cliSource, /shell:\s*true[,}]/);
  assert.match(cliSource, /NITRO_HOST/);
  assert.match(cliSource, /NITRO_PORT/);
  assert.match(cliSource, /PI_WEB_HOSTNAME/);
  assert.match(cliSource, /Listening|Server listening/);
});

function buildFakePackage() {
  const fixture = mkdtempSync(join(tmpdir(), "pi-web-cli-fixture-"));
  mkdirSync(join(fixture, "bin"), { recursive: true });
  mkdirSync(join(fixture, ".output", "server"), { recursive: true });
  writeFileSync(join(fixture, "bin", "pi-web.js"), readFileSync(join(ROOT, "bin", "pi-web.js"), "utf8"));
  writeFileSync(join(fixture, "bin", "pi-web-options.js"), readFileSync(join(ROOT, "bin", "pi-web-options.js"), "utf8"));
  writeFileSync(join(fixture, "bin", "node-version.js"), readFileSync(join(ROOT, "bin", "node-version.js"), "utf8"));
  writeFileSync(join(fixture, ".output", "server", "index.mjs"), [
    'console.log(JSON.stringify({',
    '  host: process.env.NITRO_HOST,',
    '  port: process.env.NITRO_PORT,',
    '  piWebHostname: process.env.PI_WEB_HOSTNAME,',
    '}));',
    'console.log("Listening on http://" + process.env.NITRO_HOST + ":" + process.env.NITRO_PORT);',
    'process.exit(Number(process.env.FAKE_EXIT_CODE || 0));',
    '',
  ].join("\n"));
  return fixture;
}

function runCli(fixture, args, env) {
  return spawnSync(process.execPath, [join(fixture, "bin", "pi-web.js"), ...args], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

test("the CLI spawns Nitro with mapped environment and propagates warnings and exit codes", () => {
  const fixture = buildFakePackage();
  const result = runCli(fixture, ["--no-open", "-H", "0.0.0.0", "-p", "30222"], {
    PI_WEB_PASSWORD: "cli-test-password",
  });
  assert.equal(result.status, 0, result.stderr);
  const reported = JSON.parse(result.stdout.trim().split("\n")[0]);
  assert.equal(reported.host, "0.0.0.0");
  assert.equal(reported.port, "30222");
  assert.equal(reported.piWebHostname, "0.0.0.0");
  assert.match(result.stderr, /Basic Auth|password|HTTP/i, "stderr must carry the Basic Auth over HTTP warning");
});

test("the CLI refuses a non-loopback bind without a password", () => {
  const fixture = buildFakePackage();
  const result = runCli(fixture, ["--no-open", "-H", "0.0.0.0", "-p", "30224"], {
    PI_WEB_PASSWORD: "",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /password|authentication/i);
  assert.doesNotMatch(result.stdout, /Listening/);
});

test("the CLI propagates the child exit code", () => {
  const fixture = buildFakePackage();
  const result = runCli(fixture, ["--no-open", "-H", "127.0.0.1", "-p", "30223"], {
    FAKE_EXIT_CODE: "7",
  });
  assert.equal(result.status, 7);
});
