#!/usr/bin/env node
"use strict";

/**
 * Bootstrap for the agent host process. See docs/adr/0008-agent-process-boundary.md.
 *
 * Loads lib/agent-host.ts through jiti so a checkout needs no build step. A
 * published package cannot do this — `files` ships `.next`, `bin`, and `public`,
 * not the TypeScript sources — so shipping builds will run a bundled artifact
 * from the same entry point instead.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createJiti } = require("jiti");

function parseArgs(argv) {
  const options = { sessionId: "", socketPath: undefined, sessionFile: undefined, cwd: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--session-id") options.sessionId = read();
    else if (arg === "--socket") options.socketPath = read();
    else if (arg === "--session-file") options.sessionFile = read();
    else if (arg === "--cwd") options.cwd = read();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.sessionId) throw new Error("--session-id is required");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const jiti = createJiti(__filename, { interopDefault: false });
  const { runAgentHost } = await jiti.import("../lib/agent-host.ts");
  await runAgentHost({
    sessionId: options.sessionId,
    sessionFile: options.sessionFile ?? null,
    cwd: options.cwd,
    socketPath: options.socketPath,
  });
}

main().catch((error) => {
  console.error(`[pi-web agent-host] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
