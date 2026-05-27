// This route is no longer used — new sessions are created fully client-side.
// Kept as a no-op for reference.
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export async function POST(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  return new Response("Not used", { status: 410 });
}
