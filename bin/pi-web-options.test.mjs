import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("./pi-web-options.js");

test("reports the first positional argument", () => {
  assert.deepEqual(parseLaunchOptions(["update"]).positionals, ["update"]);
  assert.deepEqual(parseLaunchOptions(["update", "--port", "8080"]).positionals, ["update"]);
  assert.deepEqual(parseLaunchOptions(["--port", "8080", "update"]).positionals, ["update"]);
  assert.deepEqual(parseLaunchOptions(["--port", "8080"]).positionals, []);
  assert.deepEqual(parseLaunchOptions([]).positionals, []);
});

test("does not mistake option values for positional arguments", () => {
  assert.deepEqual(parseLaunchOptions(["--hostname", "update"]).positionals, []);
  assert.deepEqual(parseLaunchOptions(["--port", "update"]).positionals, []);
});

test("keeps launch options stable", () => {
  const options = parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0", "--no-open"]);
  assert.equal(options.port, "8080");
  assert.equal(options.hostname, "0.0.0.0");
  assert.equal(options.openBrowser, false);
});
