import { createHash } from "node:crypto";
import type { Stats } from "node:fs";

export interface FileVersion {
  exists: boolean;
  size: number;
  mtimeMs: number | null;
  ctimeMs: number | null;
  ino: number | null;
  etag: string;
  lastModified: string | null;
}

type VersionStats = Pick<Stats, "size" | "mtimeMs" | "ctimeMs" | "ino" | "mtime">;

function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function createFileVersion(stat?: VersionStats): FileVersion {
  const fields = stat
    ? {
        exists: true,
        size: stat.size,
        mtimeMs: finiteNumber(stat.mtimeMs),
        ctimeMs: finiteNumber(stat.ctimeMs),
        ino: finiteNumber(stat.ino),
        lastModified: stat.mtime.toUTCString(),
      }
    : {
        exists: false,
        size: 0,
        mtimeMs: null,
        ctimeMs: null,
        ino: null,
        lastModified: null,
      };
  const digest = createHash("sha256")
    .update(JSON.stringify([
      fields.exists,
      fields.size,
      fields.mtimeMs,
      fields.ctimeMs,
      fields.ino,
    ]))
    .digest("base64url");
  return { ...fields, etag: `"fv1-${digest}"` };
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//, "");
}

export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = normalizeEtag(candidate);
    return normalized === "*" || normalized === etag;
  });
}

export function matchesIfModifiedSince(
  header: string | null,
  lastModified: string | null,
): boolean {
  if (!header || !lastModified) return false;
  const requestedTime = Date.parse(header);
  const modifiedTime = Date.parse(lastModified);
  if (!Number.isFinite(requestedTime) || !Number.isFinite(modifiedTime)) return false;
  return modifiedTime <= requestedTime;
}

export function fileVersionHeaders(version: FileVersion): Headers {
  const headers = new Headers({
    ETag: version.etag,
    "Cache-Control": "private, no-cache",
  });
  if (version.lastModified) headers.set("Last-Modified", version.lastModified);
  return headers;
}
