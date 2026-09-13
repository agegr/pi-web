import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const PI_SESSIONS_PACKAGE_DIR = join("npm", "node_modules", "pi-sessions");
const REINDEX_SCRIPT = String.raw`
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[1] ?? "{}");
const require = createRequire(process.cwd() + "/package.json");
const { createJiti } = require(config.jitiPath);
const jiti = createJiti(config.packageRoot, {
  alias: config.alias,
  interopDefault: false,
  moduleCache: false,
  tryNative: true,
});
const settingsModule = await jiti.import(
  pathToFileURL(join(config.packageRoot, "extensions", "shared", "settings.ts")).href,
);
const schemaModule = await jiti.import(
  pathToFileURL(join(config.packageRoot, "extensions", "shared", "session-index", "schema.ts")).href,
);
const commonModule = await jiti.import(
  pathToFileURL(join(config.packageRoot, "extensions", "shared", "session-index", "common.ts")).href,
);
const reindexModule = await jiti.import(
  pathToFileURL(join(config.packageRoot, "extensions", "session-search", "reindex.ts")).href,
);
const settings = settingsModule.loadSettings();
const status = schemaModule.getIndexStatus(settings.index.path);
if (
  status.exists &&
  status.schemaVersion === commonModule.INDEX_SCHEMA_VERSION &&
  status.lastFullReindexAt
) {
  process.exit(0);
}
const result = await reindexModule.rebuildSessionIndex({ indexPath: settings.index.path });
process.stdout.write(JSON.stringify(result));
`;

interface PiSessionIndexState {
  startedFor?: string;
}

interface PiSessionsRuntimeConfig {
  packageRoot: string;
  jitiPath: string;
  alias: Record<string, string>;
}

declare global {
  var __piWebPiSessionIndex: PiSessionIndexState | undefined;
}

/**
 * Start the community pi-sessions full reindex once per agent directory.
 *
 * pi-sessions' own lifecycle hooks keep the index current after this initial
 * pass. Running the full pass in a child process keeps the web server's event
 * loop responsive while old JSONL sessions are being scanned.
 */
export function ensurePiSessionsIndex(): void {
  const packageRoot = getPiSessionsPackageRoot();
  if (!packageRoot) {
    return;
  }

  const state = globalThis.__piWebPiSessionIndex ?? {};
  if (state.startedFor === packageRoot) {
    return;
  }
  state.startedFor = packageRoot;
  globalThis.__piWebPiSessionIndex = state;

  const config = buildPiSessionsRuntimeConfig(packageRoot);
  if (!config) {
    return;
  }

  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", REINDEX_SCRIPT, JSON.stringify(config)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  child.once("error", (error) => {
    console.warn(`[pi-web] Automatic session index failed to start: ${String(error)}`);
  });
  child.once("close", (code) => {
    if (code !== 0) {
      const detail = stderr.trim();
      console.warn(
        `[pi-web] Automatic session index failed${detail ? `: ${detail}` : ` (exit ${code})`}`,
      );
    }
  });
}

export function getPiSessionsPackageRoot(agentDir = getAgentDir()): string | undefined {
  const packageRoot = join(agentDir, PI_SESSIONS_PACKAGE_DIR);
  return existsSync(join(packageRoot, "package.json")) ? packageRoot : undefined;
}

function buildPiSessionsRuntimeConfig(packageRoot: string): PiSessionsRuntimeConfig | undefined {
  try {
    // The launcher sets cwd to the Pi Web package directory. Keep these paths
    // explicit so webpack does not replace a dynamic require.resolve call in
    // the production server bundle.
    const nodeModules = join(process.cwd(), "node_modules");
    const earendilRoot = join(nodeModules, "@earendil-works");
    const codingAgentEntry = join(earendilRoot, "pi-coding-agent", "dist", "index.js");
    const jitiPath = firstExisting([
      join(nodeModules, "jiti", "lib", "jiti.cjs"),
      join(earendilRoot, "pi-coding-agent", "node_modules", "jiti", "lib", "jiti.cjs"),
    ]);
    const typeboxEntry = join(nodeModules, "typebox", "build", "index.mjs");
    const typeboxValueEntry = join(nodeModules, "typebox", "build", "value", "index.mjs");
    if (
      !existsSync(codingAgentEntry) ||
      !jitiPath ||
      !existsSync(typeboxEntry) ||
      !existsSync(typeboxValueEntry)
    ) {
      throw new Error("Pi Web runtime dependencies are incomplete");
    }

    return {
      packageRoot,
      jitiPath,
      alias: {
        "@earendil-works/pi-agent-core": join(earendilRoot, "pi-agent-core", "dist", "index.js"),
        "@earendil-works/pi-ai": join(earendilRoot, "pi-ai", "dist", "index.js"),
        "@earendil-works/pi-coding-agent": codingAgentEntry,
        "@earendil-works/pi-tui": join(earendilRoot, "pi-tui", "dist", "index.js"),
        typebox: typeboxEntry,
        "typebox/value": typeboxValueEntry,
      },
    };
  } catch (error) {
    console.warn(`[pi-web] Automatic session index is unavailable: ${String(error)}`);
    return undefined;
  }
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}
