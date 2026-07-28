/** Initializes the Node.js server runtime, announces the setup token, and configures the server request proxy.
 * @returns A Promise that resolves when initialization is complete.
 * @throws If the authentication module or request proxy initialization fails.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { announceSetupToken } = await import("@/lib/pi-web-auth");
  announceSetupToken();
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
