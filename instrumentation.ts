export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 2026-09-06 root-cause fix for the recurring "zombie node, 502" outages:
  // on SIGINT/SIGTERM Next 16 (production) runs server.close() and waits for
  // ALL connections to end before process.exit — with no timeout. Our SSE
  // streams (app/api/agent/[id]/events) only end when the CLIENT disconnects,
  // so a Servy stop left the process draining forever: not listening (502)
  // but never exiting, and every restart leaked one orphan. Closing the
  // streams here lets Next's drain finish and the process exit cleanly.
  const { closeAllAgentEventStreams } = await import("@/lib/agent-event-stream");
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
