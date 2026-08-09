import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getCommandPositionals, parseLaunchOptions } = require("./pi-web-options.js");

test("reports the first positional argument", () => {
  assert.deepEqual(getCommandPositionals(["update"]), ["update"]);
  assert.deepEqual(getCommandPositionals(["update", "--port", "8080"]), ["update"]);
  assert.deepEqual(getCommandPositionals(["--port", "8080", "update"]), ["update"]);
  assert.deepEqual(getCommandPositionals(["--port", "8080"]), []);
  assert.deepEqual(getCommandPositionals([]), []);
});

test("does not mistake option values for positional arguments", () => {
  assert.deepEqual(getCommandPositionals(["--hostname", "update"]), []);
  assert.deepEqual(getCommandPositionals(["--port", "update"]), []);
});

test("keeps launch options stable", () => {
  const options = parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0", "--no-open"]);
  assert.equal(options.port, "8080");
  assert.equal(options.hostname, "0.0.0.0");
  assert.equal(options.openBrowser, false);
});
