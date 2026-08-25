import { removeSubscription } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// POST /api/push/unsubscribe - remove a push subscription, e.g. when the
// browser revokes the notification permission.
export async function POST(req: Request): Promise<Response> {
  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.endpoint !== "string" || !/^https:\/\//.test(body.endpoint)) {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  await removeSubscription(body.endpoint);
  return Response.json({ ok: true });
}
