import { hasJsonContentType, isApiRequestAllowed, isLoopbackApiRequest } from "@/lib/request-security";
import { readRemoteAccessSnapshot, writeRemoteAccessConfig } from "@/lib/remote-access-config";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return Response.json(readRemoteAccessSnapshot(req));
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body: unknown = await req.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Settings object is required", code: "invalid_hostname" }, { status: 400 });
    }

    let password: string | null | undefined;
    if ("password" in body) {
      if (body.password === null) password = null;
      else if (typeof body.password === "string") password = body.password;
      else {
        return Response.json({ error: "password must be a string or null", code: "password_invalid" }, { status: 400 });
      }
    }

    const result = writeRemoteAccessConfig({
      allowedHosts: body.allowedHosts,
      password,
      loopbackRequest: isLoopbackApiRequest(req),
      request: req,
    });
    if (!result.ok) {
      return Response.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return Response.json(result.snapshot);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
