import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const {
  MIN_BUN_VERSION,
  MIN_NODE_VERSION,
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  getUnsupportedNodeVersionMessage,
  isBunVersionSupported,
  isNodeVersionSupported,
  resolveBunPath,
} = require("../bin/runtime.js");

test("accepts the minimum supported Node.js version and newer versions", () => {
  for (const version of ["22.19.0", "v22.19.0", "22.19.1", "23.0.0"]) {
    assert.equal(isNodeVersionSupported(version), true, version);
  }
});

test("rejects older and invalid Node.js versions", () => {
  for (const version of ["20.19.5", "22.18.99", "invalid"]) {
    assert.equal(isNodeVersionSupported(version), false, version);
  }
});

test("accepts the minimum supported Bun version and newer versions", () => {
  for (const version of ["1.3.14", "v1.3.14", "1.3.15", "2.0.0"]) {
    assert.equal(isBunVersionSupported(version), true, version);
  }
});

test("rejects older and invalid Bun versions", () => {
  for (const version of ["1.3.13", "1.2.99", "0.8.1", "nope"]) {
    assert.equal(isBunVersionSupported(version), false, version);
  }
});

test("keeps the package engines aligned with the startup checks", () => {
  assert.equal(packageJson.engines.node, `>=${MIN_NODE_VERSION}`);
  assert.equal(packageJson.engines.bun, `>=${MIN_BUN_VERSION}`);
});

test("reports both the required and current Node.js versions", () => {
  const message = getUnsupportedNodeVersionMessage("20.19.5");
  assert.match(message, /requires Node\.js 22\.19\.0 or newer/);
  assert.match(message, /Current Node\.js version: 20\.19\.5/);
});
test("reports both the required and current Bun versions", () => {
  const message = getUnsupportedBunVersionMessage("1.2.99");
  assert.match(message, /requires Bun 1\.3\.14 or newer/);
  assert.match(message, /Current Bun version: 1\.2\.99/);
});

test("explains how to install Bun and how to override its location", () => {
  const message = getMissingBunMessage();
  assert.match(message, /bun\.sh\/install/);
  assert.match(message, /OMP_WEB_BUN=/);
});

test("prefers OMP_WEB_BUN over PATH lookups", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-runtime-"));
  try {
    const override = join(dir, "custom-bun");
    writeFileSync(override, "");
    assert.equal(resolveBunPath({ OMP_WEB_BUN: override, PATH: "" }), override);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
