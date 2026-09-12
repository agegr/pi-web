import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getNextNodeArgs } = require("../bin/pi-web-node-args.js");

test("passes the no-wasm-lazy-compilation flag to Node on RISC-V", () => {
  assert.deepEqual(getNextNodeArgs("next-bin", ["start", "-p", "30141"], "riscv64"), [
    "--no-wasm-lazy-compilation",
    "next-bin",
    "start",
    "-p",
    "30141",
  ]);
});

test("keeps the existing Node arguments on other architectures", () => {
  for (const arch of ["x64", "arm64"]) {
    assert.deepEqual(getNextNodeArgs("next-bin", ["start"], arch), ["next-bin", "start"]);
  }
});

test("does not mutate the caller's Next.js arguments", () => {
  const nextArgs = ["start", "-H", "127.0.0.1"];

  getNextNodeArgs("next-bin", nextArgs, "riscv64");

  assert.deepEqual(nextArgs, ["start", "-H", "127.0.0.1"]);
});
