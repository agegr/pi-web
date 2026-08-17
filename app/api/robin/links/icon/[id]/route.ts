import { NextResponse } from "next/server";
import { fetchPageMetadata } from "@/extension/robin/fetch-title";
import { readIcon, storeIcon } from "@/extension/robin/icons";
import { readLinks, writeLinks } from "@/extension/robin/store";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Serve a cached icon.
 *
 * The bytes came from someone else's site, so they are served defensively:
 * `nosniff` stops the browser from reinterpreting a mislabelled file as
 * something executable, and `sandbox` neutralises anything that still tries.
 * SVG never reaches disk in the first place — see extension/robin/icons.ts.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const links = readLinks();
  const link = links.find((entry) => entry.id === id);
  if (!link?.icon) return new NextResponse(null, { status: 404 });

  const icon = readIcon(id, link.icon);
  if (!icon) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      // The file only changes when the icon is re-fetched, which mints a new
      // response anyway; a day of caching keeps the dashboard from re-reading
      // every icon on every poll.
      "Cache-Control": "private, max-age=86400",
    },
  });
}

/**
 * Fetch (or refresh) this link's icon.
 *
 * Used to backfill links saved before icons existed, and to retry one whose
 * site was unreachable. `iconCheckedAt` is stamped either way so a site with no
 * icon is not asked again on every render.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const { id } = await params;

  try {
    const links = readLinks();
    const link = links.find((entry) => entry.id === id);
    if (!link) return NextResponse.json({ error: "No such link" }, { status: 404 });

    const { iconUrl } = await fetchPageMetadata(link.url);
    const extension = iconUrl ? await storeIcon(link.id, iconUrl) : null;

    if (extension) link.icon = extension;
    else delete link.icon;
    link.iconCheckedAt = new Date().toISOString();

    writeLinks(links);
    return NextResponse.json({ icon: extension });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
