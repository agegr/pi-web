export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Re-arm a countdown that was running before the restart; never block startup.
  const { shutdownTimer } = await import("@/lib/shutdown-timer");
  try {
    await shutdownTimer.restore();
  } catch {
    // ignore
  }
}
