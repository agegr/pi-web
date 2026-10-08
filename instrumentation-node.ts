import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { startScheduleRunner, stopScheduleRunner } from "@/lib/schedule-runner";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();

  // Scheduled tasks tick for as long as the server is up. This is the only place
  // they can live: a timer in a browser tab dies when the tab closes, and the
  // point of a schedule is to fire whether or not anyone is watching.
  startScheduleRunner();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => {
    stopScheduleRunner();
    closeAllAgentEventStreams();
  };
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
