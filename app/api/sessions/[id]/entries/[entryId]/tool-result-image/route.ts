import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBase64Image(block: unknown): { data: string; mime: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  if (typeof block.data === "string" && typeof block.mimeType === "string") {
    return { data: block.data, mime: block.mimeType };
  }

  if (
    isRecord(block.source) &&
    block.source.type === "base64" &&
    typeof block.source.data === "string" &&
    typeof block.source.media_type === "string"
  ) {
    return { data: block.source.data, mime: block.source.media_type };
  }

  return null;
}

function decodeBoundedBase64(data: string): Uint8Array | null {
  // Reject malformed and obviously oversized payloads before allocating.
  if (
    data.length === 0 ||
    data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  ) {
    return null;
  }

  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return new Uint8Array(bytes);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") {
      return NextResponse.json({ error: "Tool result not found" }, { status: 404 });
    }

    const image = readBase64Image(entry.message.content[blockIndex]);
    if (!image) return NextResponse.json({ error: "Tool result image not found" }, { status: 404 });
    if (!SAFE_IMAGE_MIMES.has(image.mime)) {
      return NextResponse.json({ error: "Unsupported image type" }, { status: 415 });
    }

    const bytes = decodeBoundedBase64(image.data);
    if (!bytes) return NextResponse.json({ error: "Invalid or oversized image data" }, { status: 413 });

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
