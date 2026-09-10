"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");

function updateFromSource(sourceDir, options = {}) {
  const resolvedDir = path.resolve(sourceDir);
  const packagePath = path.join(resolvedDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    throw new Error(`Not a Pi Web source directory: ${resolvedDir}`);
  }
  if (pkg?.name !== "@agegr/pi-web") {
    throw new Error(`Expected @agegr/pi-web in ${packagePath}`);
  }

  const npm = options.npmCommand ?? (process.platform === "win32" ? "npm.cmd" : "npm");
  const run = options.run ?? ((args) => spawnSync(npm, args, {
    cwd: resolvedDir,
    stdio: "inherit",
  }));

  for (const args of [["ci"], ["run", "build"], ["install", "--global", resolvedDir]]) {
    const result = run(args);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
    }
  }

  return `Pi Web updated from ${resolvedDir}. Run \`pi-web reload\` to restart the background service.`;
}

module.exports = { updateFromSource };
