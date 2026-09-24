/**
 * install-pi-web-queue-actions.cjs
 *
 * Offline patch installer for Pi Web queue actions (v2).
 *
 * Safety Invariants:
 * 1. Default mode is DRY-RUN ONLY. It verifies the exact target file and unique code marker.
 * 2. With --apply: Strictly requires Pi Web service ports (30141 and 30142) to have NO active listeners.
 *    If either port is listening, it immediately REFUSES to apply and exits.
 * 3. Never kills, stops, starts, or restarts any services.
 * 4. Idempotent: If the patch is already present, does not re-apply. Seamlessly upgrades v1 to v2.
 * 5. Creates a timestamped backup before modifying the target file.
 */

"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const TARGET_FILE_DEFAULT = "/usr/local/lib/node_modules/@agegr/pi-web/.next/server/chunks/6429.js";
const ACTIONS_MODULE_PATH_DEFAULT = "/root/.pi/agent/scripts/pi-web-queue-actions.cjs";
const CLEAR_QUEUE_MARKER = 'case"clear_queue":return this.inner.clearQueue();';
const EXACT_V1_PATCH_REGEX = /case"get_queue_actions":return require\((?:'[^']+'|"[^"]+")\)\.snapshot\(this\.inner\);case"promote_queued_message":return require\((?:'[^']+'|"[^"]+")\)\.promote\(this\.inner,a\.token\);(?=case"clear_queue":)/;
const EXACT_V2_PATCH_REGEX = /case"get_queue_actions":return require\((?:'[^']+'|"[^"]+")\)\.snapshot\(this\.inner\);case"get_queued_message":return require\((?:'[^']+'|"[^"]+")\)\.getQueuedMessage\(this\.inner,a\.token\);case"promote_queued_message":return require\((?:'[^']+'|"[^"]+")\)\.promote\(this\.inner,a\.token\);case"recall_queued_message":return require\((?:'[^']+'|"[^"]+")\)\.recall\(this\.inner,a\.token\);case"delete_queued_message":return require\((?:'[^']+'|"[^"]+")\)\.deleteQueued\(this\.inner,a\.token\);case"recall_all_queued_messages":return require\((?:'[^']+'|"[^"]+")\)\.recallAll\(this\.inner,a\.tokens\);(?=case"clear_queue":)/;
const PORTS_TO_CHECK = [30141, 30142];

/**
 * Generate code string to inject into 6429.js right before clear_queue.
 * Uses exact known RPC parameters: this.inner, a.token, a.tokens.
 * @param {string} modulePath Absolute path to pi-web-queue-actions.cjs
 * @returns {string}
 */
function buildPatchCode(modulePath) {
  const quotedPath = JSON.stringify(modulePath);
  return `case"get_queue_actions":return require(${quotedPath}).snapshot(this.inner);case"get_queued_message":return require(${quotedPath}).getQueuedMessage(this.inner,a.token);case"promote_queued_message":return require(${quotedPath}).promote(this.inner,a.token);case"recall_queued_message":return require(${quotedPath}).recall(this.inner,a.token);case"delete_queued_message":return require(${quotedPath}).deleteQueued(this.inner,a.token);case"recall_all_queued_messages":return require(${quotedPath}).recallAll(this.inner,a.tokens);`;
}

/**
 * Inspect chunk content to verify compatibility and installation status.
 * Strictly verifies exact v1/v2 patch blocks and fails closed on any partial or unrecognized markers.
 * @param {string} content
 * @returns {{ installed: boolean, isUpgrade: boolean, compatible: boolean, markerCount: number, reason?: string }}
 */
function inspectChunk(content) {
  if (typeof content !== "string") {
    return { installed: false, isUpgrade: false, compatible: false, markerCount: 0, reason: "Content is not a string" };
  }

  const markerCount = content.split(CLEAR_QUEUE_MARKER).length - 1;
  if (markerCount !== 1) {
    return {
      installed: false,
      isUpgrade: false,
      compatible: false,
      markerCount,
      reason: `Expected exactly 1 clear_queue marker, found ${markerCount}`,
    };
  }

  // 1. Exact verified v2 patch block
  if (EXACT_V2_PATCH_REGEX.test(content)) {
    return { installed: true, isUpgrade: false, compatible: true, markerCount: 1 };
  }

  // 2. Exact verified legacy v1 patch block
  if (EXACT_V1_PATCH_REGEX.test(content)) {
    return { installed: false, isUpgrade: true, compatible: true, markerCount: 1 };
  }

  // 3. Fail closed if any partial, corrupt, or unrecognized queue action markers exist
  const containsAnyQueueActionMarker =
    content.includes('case"get_queue_actions":') ||
    content.includes('case"get_queued_message":') ||
    content.includes('case"promote_queued_message":') ||
    content.includes('case"recall_queued_message":') ||
    content.includes('case"delete_queued_message":') ||
    content.includes('case"recall_all_queued_messages":');

  if (containsAnyQueueActionMarker) {
    return {
      installed: false,
      isUpgrade: false,
      compatible: false,
      markerCount: 1,
      reason: "Corrupt, partial, or unrecognized queue action patch markers detected",
    };
  }

  // 4. Clean unpatched file
  return { installed: false, isUpgrade: false, compatible: true, markerCount: 1 };
}

/**
 * Socket-based port connection test (short timeout).
 * @param {number} port
 * @param {string} host
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function checkPortViaSocket(port, host = "127.0.0.1", timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Check Linux /proc/net/tcp and /proc/net/tcp6 for listening sockets.
 * @param {number} port
 * @param {string} procPath
 * @returns {boolean}
 */
function checkPortViaProcNet(port, procPath = "/proc/net/tcp") {
  try {
    if (!fs.existsSync(procPath)) return false;
    const content = fs.readFileSync(procPath, "utf8");
    const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
    const lines = content.split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const localAddr = parts[1];
        const state = parts[3];
        // state '0A' is TCP_LISTEN
        if (localAddr && localAddr.endsWith(":" + hexPort) && state === "0A") {
          return true;
        }
      }
    }
  } catch {
    // Ignore procfs read error
  }
  return false;
}

/**
 * Detect whether a port is currently being listened on.
 * @param {number} port
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
async function isPortListening(port, options = {}) {
  if (typeof options.checkPortFn === "function") {
    return options.checkPortFn(port);
  }

  if (checkPortViaProcNet(port, "/proc/net/tcp") || checkPortViaProcNet(port, "/proc/net/tcp6")) {
    return true;
  }

  const v4 = await checkPortViaSocket(port, "127.0.0.1");
  if (v4) return true;

  const v6 = await checkPortViaSocket(port, "::1");
  if (v6) return true;

  return false;
}

/**
 * Check whether any required service ports are actively listening.
 * @param {number[]} ports
 * @param {object} [options]
 * @returns {Promise<number[]>} Array of active ports
 */
async function getActiveListeningPorts(ports = PORTS_TO_CHECK, options = {}) {
  const active = [];
  for (const port of ports) {
    if (await isPortListening(port, options)) {
      active.push(port);
    }
  }
  return active;
}

/**
 * Execute installer inspection or application.
 *
 * @param {object} [options]
 * @param {boolean} [options.apply=false] If false, operates strictly in dry-run mode
 * @param {string} [options.targetFile] Target chunk file path
 * @param {string} [options.actionsModulePath] Module path to inject
 * @param {number[]} [options.ports] Ports to verify idle
 * @param {function} [options.checkPortFn] Custom port-checking function for testing
 * @returns {Promise<{ success: boolean, dryRun: boolean, installed: boolean, changed: boolean, backupFile?: string, message: string }>}
 */
async function runInstall(options = {}) {
  const apply = Boolean(options.apply);
  const targetFile = options.targetFile || TARGET_FILE_DEFAULT;
  const actionsModulePath = options.actionsModulePath || ACTIONS_MODULE_PATH_DEFAULT;
  const ports = options.ports || PORTS_TO_CHECK;

  if (!fs.existsSync(targetFile)) {
    throw new Error(`Target file does not exist: ${targetFile}`);
  }

  const originalContent = fs.readFileSync(targetFile, "utf8");
  const patchCode = buildPatchCode(actionsModulePath);
  const inspection = inspectChunk(originalContent);

  if (inspection.installed) {
    const msg = `Target file is already patched with queue actions v2: ${targetFile}`;
    return {
      success: true,
      dryRun: !apply,
      installed: true,
      changed: false,
      message: msg,
    };
  }

  if (!inspection.compatible) {
    throw new Error(
      `Target file version is incompatible: ${inspection.reason || "unknown incompatibility"}`
    );
  }

  // Dry-run mode: verify and report without making changes
  if (!apply) {
    const statusText = inspection.isUpgrade ? "Legacy queue patch detected. Ready to upgrade to v2." : "Unique clear_queue marker verified.";
    const msg = `[Dry-run] Validation successful: ${statusText} Ready for offline patch in ${targetFile}.`;
    return {
      success: true,
      dryRun: true,
      installed: false,
      changed: false,
      message: msg,
    };
  }

  // Apply mode: strictly check that Pi Web ports are NOT listening
  const activePorts = await getActiveListeningPorts(ports, options);
  if (activePorts.length > 0) {
    throw new Error(
      `Refusing to apply: Pi Web service is currently active on port(s) ${activePorts.join(
        ", "
      )}. The service must be stopped manually by the user before running --apply.`
    );
  }

  // Double check module exists before writing patch
  if (!fs.existsSync(actionsModulePath)) {
    throw new Error(`Actions module path does not exist: ${actionsModulePath}`);
  }

  // Save backup
  const backupFile = `${targetFile}.bak.${Date.now()}`;
  fs.copyFileSync(targetFile, backupFile);

  let patchedContent;
  if (inspection.isUpgrade) {
    patchedContent = originalContent.replace(EXACT_V1_PATCH_REGEX, patchCode);
  } else {
    patchedContent = originalContent.replace(
      CLEAR_QUEUE_MARKER,
      patchCode + CLEAR_QUEUE_MARKER
    );
  }

  const postInspection = inspectChunk(patchedContent);
  if (!postInspection.installed) {
    throw new Error("Post-patch verification failed: patch was not cleanly installed");
  }

  fs.writeFileSync(targetFile, patchedContent, "utf8");

  const actionText = inspection.isUpgrade ? "upgraded queue actions to v2 in" : "applied queue actions patch to";
  const msg = `Successfully ${actionText} ${targetFile}. Backup saved to ${backupFile}.`;
  return {
    success: true,
    dryRun: false,
    installed: true,
    changed: true,
    backupFile,
    message: msg,
  };
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  runInstall({ apply })
    .then((result) => {
      console.log(result.message);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[installer-error] ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  TARGET_FILE_DEFAULT,
  ACTIONS_MODULE_PATH_DEFAULT,
  CLEAR_QUEUE_MARKER,
  EXACT_V1_PATCH_REGEX,
  EXACT_V2_PATCH_REGEX,
  PORTS_TO_CHECK,
  buildPatchCode,
  inspectChunk,
  checkPortViaSocket,
  checkPortViaProcNet,
  isPortListening,
  getActiveListeningPorts,
  runInstall,
};
