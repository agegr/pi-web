// node-pty 1.1.0 ships macOS spawn-helper binaries without executable bits.
// Remove this workaround once the upstream package preserves those modes.
/* eslint-disable @typescript-eslint/no-require-imports */
const { chmodSync, statSync } = require("node:fs");
const { dirname, join } = require("node:path");

if (process.platform === "darwin") {
  const root = dirname(require.resolve("node-pty/package.json"));
  for (const directory of ["build/Release", "build/Debug", `prebuilds/darwin-${process.arch}`]) {
    const helper = join(root, directory, "spawn-helper");
    const stat = statSync(helper, { throwIfNoEntry: false });
    if (stat?.isFile() && (stat.mode & 0o111) !== 0o111) chmodSync(helper, stat.mode | 0o111);
  }
}
