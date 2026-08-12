import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const tarballPath = process.argv[2];
if (!tarballPath || !isAbsolute(tarballPath) || !tarballPath.endsWith(".tgz")) {
  console.error("release-tanstack: expected an absolute .tgz path produced by pack:tanstack");
  process.exit(1);
}
if (!existsSync(tarballPath)) {
  console.error(`release-tanstack: tarball not found: ${tarballPath}`);
  process.exit(1);
}

const result = spawnSync("npm", ["publish", tarballPath, "--access", "public"], {
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
