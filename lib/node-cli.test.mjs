import assert from "node:assert/strict";
import { join } from "node:path";
import { execPath } from "node:process";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { findNodeCliScript, nodeCliInvocation } = await jiti.import("./node-cli.ts");

const nodeDir = join("opt", "node", "bin");
const windowsScript = join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
const unixScript = join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");

test("both bundled install layouts are probed", () => {
  assert.equal(findNodeCliScript("npm", { nodeDir, fileExists: (p) => p === windowsScript }), windowsScript);
  assert.equal(findNodeCliScript("npm", { nodeDir, fileExists: (p) => p === unixScript }), unixScript);
  assert.equal(findNodeCliScript("npx", { nodeDir, fileExists: () => false }), null);
});

test("the Windows layout wins when both candidates exist", () => {
  assert.equal(findNodeCliScript("npx", { nodeDir, fileExists: () => true }), join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"));
});

test("npm and npx run through node instead of a .cmd shim", () => {
  const options = { nodeDir, fileExists: (p) => p === windowsScript };
  assert.deepEqual(nodeCliInvocation("npm", ["view", "some-pkg", "version", "--json"], options), {
    command: execPath,
    args: [windowsScript, "view", "some-pkg", "version", "--json"],
  });
});

test("a missing CLI script keeps the bare command and its args", () => {
  assert.deepEqual(
    nodeCliInvocation("npx", ["skills", "find", "pdf"], { nodeDir, fileExists: () => false }),
    { command: "npx", args: ["skills", "find", "pdf"] },
  );
});
