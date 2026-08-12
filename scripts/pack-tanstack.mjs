import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.stdio ?? "inherit",
    shell: false,
    ...options,
  });
  if (result.error) {
    console.error(`[pack-tanstack] ${command} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

const outputDir = mkdtempSync(join(tmpdir(), "pi-web-tanstack-pack-output-"));
const stageDir = mkdtempSync(join(tmpdir(), "pi-web-tanstack-pack-stage-"));

try {
  run("npm", ["run", "build:tanstack"], {
    env: {
      ...process.env,
      PI_WEB_TANSTACK_OUTPUT_DIR: outputDir,
      PI_WEB_TANSTACK_OUTPUT_MODE: "publication",
    },
  });

  run(process.execPath, ["scripts/verify-tanstack-output.mjs", "--mode", "publication", outputDir]);

  run(process.execPath, ["scripts/stage-tanstack-package.mjs", outputDir, stageDir]);

  const packResult = spawnSync("npm", ["pack", "--json"], {
    cwd: stageDir,
    encoding: "utf8",
    shell: false,
  });
  if (packResult.error || packResult.status !== 0) {
    console.error(packResult.stderr || packResult.stdout);
    process.exit(packResult.status ?? 1);
  }
  const packEntries = JSON.parse(packResult.stdout);
  const packEntry = Array.isArray(packEntries) ? packEntries[0] : packEntries;
  const tarballPath = join(stageDir, packEntry.filename);

  if (existsSync("scripts/smoke-installed-package.mjs")) {
    run(process.execPath, ["scripts/smoke-installed-package.mjs", tarballPath], {
      env: { ...process.env, PI_WEB_TANSTACK_SMOKE_PORT: process.env.PI_WEB_TANSTACK_SMOKE_PORT || "30147" },
    });
  }

  const tarballStat = statSync(tarballPath);
  const integrity = createHash("sha512").update(readFileSync(tarballPath)).digest("hex");
  console.log(JSON.stringify({
    outputDir,
    stageDir,
    tarballPath,
    filename: packEntry.filename,
    size: tarballStat.size,
    integrity,
  }, null, 2));
} catch (error) {
  console.error(`[pack-tanstack] failed: ${error.message}`);
  console.error(JSON.stringify({ outputDir, stageDir }));
  process.exit(1);
}
