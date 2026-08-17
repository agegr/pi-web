/**
 * Download and cache link icons on disk.
 *
 * Server-only. Icons are fetched once when a link is saved and stored under
 * ~/.pi/robin/icons, so rendering the dashboard makes no outbound requests: the
 * page works offline, and the list of sites you have saved is never disclosed
 * to a third-party favicon service.
 *
 * Everything here handles untrusted input. The icon URL comes out of a page we
 * fetched, so it is treated the way any remote reference would be: capped in
 * time and size, checked for content type, and restricted in format.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./paths.ts";

const TIMEOUT_MS = 5_000;
/** A favicon is a few kilobytes; anything of this size is not one. */
const MAX_BYTES = 256 * 1024;

/**
 * Formats accepted, mapped to the extension used on disk.
 *
 * SVG is deliberately absent. An SVG can carry script, and serving one from our
 * own origin — which is what a cached icon route does — would turn a favicon
 * reference on someone else's page into script running on this dashboard's
 * origin. Raster formats cannot do that.
 */
const ACCEPTED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/ico": "ico",
};

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
};

export function iconsDir(): string {
  return dataPath("icons");
}

/** Ids come from `newId()` — reject anything else before it reaches the filesystem. */
function safeId(id: string): string | null {
  return /^[a-z0-9]{1,32}$/i.test(id) ? id : null;
}

export function iconPath(id: string, extension: string): string {
  return join(iconsDir(), `${id}.${extension}`);
}

export function readIcon(id: string, extension: string): { body: Buffer; contentType: string } | null {
  if (!safeId(id) || !CONTENT_TYPES[extension]) return null;
  try {
    return {
      body: readFileSync(iconPath(id, extension)),
      contentType: CONTENT_TYPES[extension] as string,
    };
  } catch {
    return null;
  }
}

export function removeIcon(id: string, extension: string | undefined): void {
  if (!extension || !safeId(id)) return;
  try {
    rmSync(iconPath(id, extension), { force: true });
  } catch {
    // An icon that cannot be removed is not worth failing a delete over.
  }
}

/**
 * Fetch an icon and store it. Returns the extension it was saved with, or null
 * when nothing usable came back — a missing icon is normal, not an error.
 *
 * Tries the conventional /favicon.ico when the declared icon yields nothing.
 * Sites increasingly declare an SVG, which this cache refuses, but nearly all
 * of them still serve a raster favicon at the classic path — Hacker News is
 * exactly this case.
 */
export async function storeIcon(id: string, iconUrl: string): Promise<string | null> {
  const direct = await storeIconFrom(id, iconUrl);
  if (direct) return direct;

  try {
    const conventional = new URL("/favicon.ico", iconUrl).toString();
    if (conventional === iconUrl) return null;
    return await storeIconFrom(id, conventional);
  } catch {
    return null;
  }
}

async function storeIconFrom(id: string, iconUrl: string): Promise<string | null> {
  if (!safeId(id)) return null;

  let parsed: URL;
  try {
    parsed = new URL(iconUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RobinDashboard/1.0)",
        Accept: "image/png,image/webp,image/*",
      },
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const extension = ACCEPTED[contentType];
    if (!extension) return null;

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    // Checked again after reading: content-length is a claim, not a guarantee.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    mkdirSync(iconsDir(), { recursive: true });
    const target = iconPath(id, extension);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
    return extension;
  } catch {
    // Unreachable host, wrong format, timeout — all just mean "no icon".
    return null;
  } finally {
    clearTimeout(timer);
  }
}
