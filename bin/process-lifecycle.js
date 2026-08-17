"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");

const forwardedSignals = ["SIGINT", "SIGTERM"];
const shutdownTimeoutMs = 5_000;

function getSignalExitCode(signal) {
  const signalNumber = signal ? os.constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function describeExit(code, signal) {
  return signal ? `signal ${signal}` : `code ${code}`;
}

function wireChildProcessLifecycle(
  child,
  parentProcess = process,
  timeoutMs = shutdownTimeoutMs,
  log = console.error,
) {
  const signalHandlers = new Map();
  let shutdownTimer;
  // Set once we forward a signal, so an exit we asked for stays quiet and one
  // we did not gets reported.
  let shuttingDown = false;

  const forceKill = () => child.kill("SIGKILL");

  const unwire = () => {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }
  };

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (shutdownTimer) {
        forceKill();
        return;
      }

      shuttingDown = true;
      shutdownTimer = setTimeout(forceKill, timeoutMs);
      shutdownTimer.unref();
      child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  // Without a listener an 'error' event is fatal to the wrapper itself, so a
  // spawn failure surfaced as a bare stack trace rather than a reason.
  child.once("error", (error) => {
    unwire();
    log(`[pi-web] could not run the Next.js process: ${error.message}`);
    parentProcess.exit(1);
  });

  child.once("exit", (code, signal) => {
    unwire();

    // A shutdown the user asked for needs no explanation; anything else left
    // the window closing with no stated reason.
    if (!shuttingDown && (signal || (code ?? 0) !== 0)) {
      log(`[pi-web] Next.js exited unexpectedly (${describeExit(code, signal)})`);
    }

    parentProcess.exit(code ?? getSignalExitCode(signal));
  });
}

module.exports = { wireChildProcessLifecycle };
