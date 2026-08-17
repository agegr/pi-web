import { NextResponse } from "next/server";
import { fetchPageMetadata, nameFromUrl } from "@/extension/robin/fetch-title";
import { removeIcon, storeIcon } from "@/extension/robin/icons";
import {
  groupLinks,
  newId,
  normalizeUrl,
  readLinks,
  reorderLinkGroups,
  writeLinks,
  type Link,
} from "@/extension/robin/store";
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
    // One fetch yields both: the icon link sits in the same head as the title.
    const { title: fetched, iconUrl } = await fetchPageMetadata(url);
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : fetched || nameFromUrl(url);
    const group = typeof body.group === "string" && body.group.trim() ? body.group.trim() : undefined;

    const id = newId();
    const icon = iconUrl ? await storeIcon(id, iconUrl) : null;

    const links = readLinks();
    const link: Link = {
      id,
      title,
      url,
      ...(group ? { group } : {}),
      ...(icon ? { icon } : {}),
      iconCheckedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    links.push(link);
    writeLinks(links);
    return NextResponse.json({ link });
  } catch (error) {
    return fail(error);
  }
}

/** Edit a link's address, name, or group. */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      action?: unknown;
      groups?: unknown;
      id?: unknown;
      title?: unknown;
      url?: unknown;
      group?: unknown;
    };
    const links = readLinks();

    if (body.action === "reorderGroups") {
      if (!Array.isArray(body.groups) || !body.groups.every((group) => typeof group === "string")) {
        return fail(new Error("groups must be an array of names"));
      }
      const requested = body.groups.map((group) => group.trim());
      const current = groupLinks(links).map(({ group }) => group);
      if (requested.length !== current.length
        || new Set(requested).size !== requested.length
        || current.some((group) => !requested.includes(group))) {
        return fail(new Error("groups must contain every current section exactly once"));
      }
      writeLinks(reorderLinkGroups(links, requested));
      return NextResponse.json({ success: true });
    }

    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const link = links.find((entry) => entry.id === body.id);
    if (!link) return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });

    let addressChanged = false;
    if (typeof body.url === "string" && body.url.trim()) {
      // normalizeUrl still rejects javascript:/data: — an edited link ends up in
      // an href exactly like a new one.
      const url = normalizeUrl(body.url);
      addressChanged = url !== link.url;
      link.url = url;
    }

    if (typeof body.title === "string") {
      const title = body.title.trim();
      // A blank name would render as an unclickable gap, so keep the old one.
      if (!title) return fail(new Error("title cannot be empty"));
      link.title = title;
    }

    if (typeof body.group === "string") {
      const group = body.group.trim();
      if (group) link.group = group;
      else delete link.group;
    }

    if (addressChanged) {
      // The cached icon belonged to the old address; keeping it would label the
      // link with a site it no longer points at.
      removeIcon(link.id, link.icon);
      delete link.icon;

      const { title: fetched, iconUrl } = await fetchPageMetadata(link.url);
      // Only adopt the fetched title when the caller did not supply one — an
      // explicit rename must not be overwritten by the new page's own name.
      if (typeof body.title !== "string" && fetched) link.title = fetched;

      const icon = iconUrl ? await storeIcon(link.id, iconUrl) : null;
      if (icon) link.icon = icon;
      link.iconCheckedAt = new Date().toISOString();
    }

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
    const doomed = links.find((l) => l.id === body.id);
    const remaining = links.filter((l) => l.id !== body.id);
    if (remaining.length === links.length) {
      return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
    }
    // Otherwise the cache accumulates icons for links that no longer exist.
    if (doomed) removeIcon(doomed.id, doomed.icon);
    writeLinks(remaining);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
