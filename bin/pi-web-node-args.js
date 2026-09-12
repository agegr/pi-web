"use strict";

function getNextNodeArgs(nextBin, nextArgs, arch = process.arch) {
  if (arch === "riscv64") {
    return ["--no-wasm-lazy-compilation", nextBin, ...nextArgs];
  }

  return [nextBin, ...nextArgs];
}

module.exports = { getNextNodeArgs };
