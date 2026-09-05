import { getVapidPublicKey } from "@/lib/web-push";
import type { PushConfigResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

// GET /api/push/config - VAPID public key for client-side push subscriptions.
// The private key never leaves the server.
export async function GET(): Promise<Response> {
  const publicKey = await getVapidPublicKey();
  const body: PushConfigResponse = { publicKey };
  return Response.json(body);
}
