export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Start the external-write watcher so TUI (or other pi process) session
  // writes invalidate the session list cache without a manual reload.
  const { ensureSessionWatcher } = await import("@/lib/session-watcher");
  ensureSessionWatcher();
}
