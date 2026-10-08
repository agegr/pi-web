export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the allowed size");
  }
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

async function readBodyChunksWithinLimit(request: Request, maxBytes: number): Promise<BlobPart[] | null> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      size += value.byteLength;
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}

/**
 * Parse multipart data only after constraining the complete wire body. This
 * bounds chunked requests too, where Content-Length is unavailable or false.
 */
export async function parseFormDataWithinLimit(request: Request, maxBytes: number): Promise<FormData> {
  const chunks = await readBodyChunksWithinLimit(request, maxBytes);
  if (!chunks) return request.formData();

  const contentType = request.headers.get("content-type");
  const headers = contentType ? { "content-type": contentType } : undefined;
  return new Response(new Blob(chunks), { headers }).formData();
}

/** The body as UTF-8 text, read under the same bound. */
export async function readTextWithinLimit(request: Request, maxBytes: number): Promise<string> {
  const chunks = await readBodyChunksWithinLimit(request, maxBytes);
  if (!chunks) return "";
  return new Blob(chunks).text();
}
