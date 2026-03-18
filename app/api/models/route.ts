import { getModelNameMap } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET() {
  const map = getModelNameMap();
  return Response.json({ models: Object.fromEntries(map) });
}
