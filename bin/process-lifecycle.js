"use strict";

const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
};

function wireChildProcessLifecycle(child, parentProcess = process) {
  const signalHandlers = new Map();

  for (const signal of Object.keys(signalExitCodes)) {
    const handler = () => child.kill(signal);
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  child.once("exit", (code, signal) => {
    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }

    parentProcess.exit(code ?? signalExitCodes[signal] ?? 1);
  });
}

module.exports = { wireChildProcessLifecycle };
