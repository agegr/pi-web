export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Probe intranet endpoints before the dispatcher is installed so the very
  // first model request already carries the right TLS connect options.
  const { loadTlsOverrides } = await import("@/lib/tls-overrides");
  await loadTlsOverrides();

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
