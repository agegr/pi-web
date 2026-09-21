import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { ensureSessionWatcher } from "@/lib/session-watcher";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();

  // Start the external-write watcher so TUI (or other pi process) session
  // writes invalidate the session list cache without a manual reload (pi#2).
  ensureSessionWatcher();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
