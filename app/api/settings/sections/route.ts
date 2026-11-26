import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getSettingsSectionsBootState, getSettingsSectionsRegistry } from "@/lib/settings-sections-host";

export const dynamic = "force-dynamic";

// Settings sections a pi extension registered (`docs/integrations.md`). The
// dialog lists them, reads one's values and status, and applies one. The
// extensions load at server start (lib/settings-sections-host.ts), so
// `ready: false` only covers the moment before that load answers — the dialog
// then shows the built-in sections, exactly as it did before this route existed.

function refusal(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const statusId = params.get("status");
  const ready = getSettingsSectionsBootState() === "ready";

  if (id === null && statusId === null) {
    if (!ready) return NextResponse.json({ ready: false, sections: [] });
    return NextResponse.json({ ready: true, sections: getSettingsSectionsRegistry().list() });
  }
  if (!ready) return refusal(503, "Extensions are still loading");

  const registry = getSettingsSectionsRegistry();
  try {
    if (statusId !== null) {
      return NextResponse.json({ status: await registry.status(statusId) ?? null });
    }
    const answer = await registry.read(id ?? "");
    if (!answer) return refusal(404, `Settings section "${id}" is not registered`);
    return NextResponse.json({ values: answer.values ?? {}, status: answer.status ?? null });
  } catch (error) {
    return refusal(500, errorMessage(error));
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "Content-Type must be application/json");
  if (getSettingsSectionsBootState() !== "ready") return refusal(503, "Extensions are still loading");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "Invalid JSON body");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal(400, "Body must be an object");
  }
  const { id, values } = body as { id?: unknown; values?: unknown };
  if (typeof id !== "string") return refusal(400, "id must be a string");
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return refusal(400, "values must be an object");
  }

  try {
    // The extension owns validation: what it throws is what the form shows.
    await getSettingsSectionsRegistry().apply(id, values as Record<string, unknown>);
  } catch (error) {
    return refusal(400, errorMessage(error));
  }
  return NextResponse.json({ ok: true });
}
