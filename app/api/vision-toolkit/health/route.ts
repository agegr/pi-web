import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readVisionToolkitSnapshot } from "@/lib/vision-toolkit-config";
import { runVisionToolkitHealth } from "@/lib/vision-toolkit-health";
import { redactVisionError } from "../route";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { testConnection?: unknown };
    const testConnection = body.testConnection === true;
    const snapshot = readVisionToolkitSnapshot();
    const result = await runVisionToolkitHealth({ testConnection, snapshot });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: redactVisionError(error) }, { status: 500 });
  }
}
