import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readVisionToolkitSnapshot } from "@/lib/vision-toolkit-config";
import { parseVisionHealthRequest, runVisionToolkitHealth } from "@/lib/vision-toolkit-health";
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
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Body must be { testConnection: boolean }" }, { status: 400 });
    }
    const parsed = parseVisionHealthRequest(body);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const snapshot = readVisionToolkitSnapshot();
    const result = await runVisionToolkitHealth({
      testConnection: parsed.testConnection,
      snapshot,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: redactVisionError(error) }, { status: 500 });
  }
}
