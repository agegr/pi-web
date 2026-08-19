export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Pre-warm the session list cache so the first /api/sessions response
  // after boot is fast even before the disk-cache layer kicks in. This
  // also kicks off the (potentially slow) `git rev-parse` enrichment for
  // any cwds the disk cache does not yet know about. Errors are swallowed —
  // a cold start must not fail because of cache warmup.
  void import("@/lib/session-reader").then(async ({ listAllSessions, scheduleProjectEnrichment }) => {
    try {
      const sessions = await listAllSessions();
      void scheduleProjectEnrichment(sessions);
    } catch (error) {
      console.warn("pi-web: session list prewarm failed:", error);
    }
  });
}
