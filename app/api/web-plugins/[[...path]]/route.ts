import { getWebPluginRuntime } from "@/lib/web-plugins-server";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All routes (including the browser module) also pass through proxy.ts auth.
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!isApiRequestAllowed(request)) return new Response("Untrusted API request", { status: 403 });
  const { path = [] } = await params;
  const plugins = await getWebPluginRuntime();
  if (!path.length) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    return Response.json({ apiVersion: 1, plugins: plugins.descriptors(), errors: plugins.errors }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  return plugins.dispatch(path[0], path.slice(1).join("/"), request);
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
