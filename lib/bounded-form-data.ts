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

export async function readRequestBodyWithinLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maxBytes) throw new RequestBodyTooLargeError();

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
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

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parse multipart data only after constraining the complete wire body. */
export async function parseFormDataWithinLimit(request: Request, maxBytes: number): Promise<FormData> {
  const body = await readRequestBodyWithinLimit(request, maxBytes);
  const contentType = request.headers.get("content-type");
  const headers = contentType ? { "content-type": contentType } : undefined;
  const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(buffer, { headers }).formData();
}

/** Parse JSON only after constraining chunked and Content-Length requests. */
export async function parseJsonWithinLimit<T>(request: Request, maxBytes: number): Promise<T> {
  const body = await readRequestBodyWithinLimit(request, maxBytes);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
}
