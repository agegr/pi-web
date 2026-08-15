import { NextResponse } from "next/server";
import { fetchPageTitle } from "@/extension/robin/fetch-title";
import { newId, normalizeUrl, readLinks, writeLinks, type Link } from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ links: readLinks() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { title?: unknown; url?: unknown; group?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) return fail(new Error("url is required"));

    // normalizeUrl also rejects javascript:/data: — the dashboard renders these as hrefs.
    const url = normalizeUrl(body.url);
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : (await fetchPageTitle(url)) || new URL(url).hostname || url;
    const group = typeof body.group === "string" && body.group.trim() ? body.group.trim() : undefined;

    const links = readLinks();
    const link: Link = {
      id: newId(),
      title,
      url,
      ...(group ? { group } : {}),
      createdAt: new Date().toISOString(),
    };
    links.push(link);
    writeLinks(links);
    return NextResponse.json({ link });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const links = readLinks();
    const remaining = links.filter((l) => l.id !== body.id);
    if (remaining.length === links.length) {
      return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
    }
    writeLinks(remaining);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
