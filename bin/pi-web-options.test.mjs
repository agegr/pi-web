import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  getCommandPositionals,
  parseLaunchOptions,
  shouldRunUpdate,
} = require("./pi-web-options.js");

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

test("dispatches only when the first positional is update", () => {
  assert.equal(shouldRunUpdate(["update"]), true);
  assert.equal(shouldRunUpdate(["--port", "8080", "update"]), true);
  assert.equal(shouldRunUpdate(["serve", "update"]), false);
  assert.equal(shouldRunUpdate([]), false);
});

test("does not dispatch update when argument parsing fails", () => {
  assert.equal(shouldRunUpdate(["--host", "update"]), false);
  assert.equal(shouldRunUpdate(["--unknown", "value", "update"]), false);
  assert.equal(shouldRunUpdate(["--hostname"]), false);
});

test("does not dispatch update when it is a known option value", () => {
  assert.equal(shouldRunUpdate(["--hostname", "update"]), false);
  assert.equal(shouldRunUpdate(["--port", "update"]), false);
});

test("keeps launch options stable", () => {
  const options = parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0", "--no-open"]);
  assert.equal(options.port, "8080");
  assert.equal(options.hostname, "0.0.0.0");
  assert.equal(options.openBrowser, false);
});
