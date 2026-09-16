const MIN_GZIP_BYTES = 1024;

function acceptedEncodingQuality(header: string, encoding: string): number {
  let wildcardQuality: number | undefined;
  for (const item of header.split(",")) {
    const [rawName, ...rawParameters] = item.trim().split(";");
    const name = rawName.trim().toLowerCase();
    let quality = 1;
    for (const rawParameter of rawParameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/i.exec(rawParameter);
      if (!match) continue;
      const value = match[1];
      quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) ? Number(value) : 0;
    }
    if (name === encoding) return quality;
    if (name === "*") wildcardQuality = quality;
  }
  return wildcardQuality ?? 0;
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (!current.split(",").some((entry) => entry.trim().toLowerCase() === value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

export function jsonResponse(
  request: Request,
  data: unknown,
  init: ResponseInit = {},
): Response {
  const body = JSON.stringify(data);
  const isLargeEnough = Buffer.byteLength(body) >= MIN_GZIP_BYTES;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  if (isLargeEnough) {
    appendVary(headers, "Accept-Encoding");
  }

  if (
    isLargeEnough
    && acceptedEncodingQuality(request.headers.get("Accept-Encoding") ?? "", "gzip") > 0
  ) {
    headers.set("Content-Encoding", "gzip");
    const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(compressed, { ...init, headers });
  }

  return new Response(body, { ...init, headers });
}
