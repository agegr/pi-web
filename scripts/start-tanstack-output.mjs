import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const outputDir = process.env.PI_WEB_TANSTACK_OUTPUT_DIR?.trim();
if (!outputDir || !isAbsolute(outputDir)) {
  console.error("PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
  process.exit(1);
}

const serverEntry = join(outputDir, "server", "index.mjs");
if (!existsSync(serverEntry)) {
  console.error(`TanStack server entry not found: ${serverEntry}`);
  process.exit(1);
}

await import(pathToFileURL(serverEntry).href);
