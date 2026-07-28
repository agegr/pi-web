import { getAuthState } from "../../../../lib/pi-web-auth";
import { getAuthenticatedSession } from "../../../../lib/pi-web-auth-route";

/** Return authentication initialization and current session status.
 * @param request Current HTTP request.
 * @returns Authentication status JSON response.
 */
export async function GET(request: Request) {
  try {
    const state = await getAuthState();
    return Response.json({ initialized: state.initialized, authenticated: state.initialized && getAuthenticatedSession(request).valid });
  } catch {
    return Response.json({ error: "Failed to read authentication status" }, { status: 500 });
  }
}
