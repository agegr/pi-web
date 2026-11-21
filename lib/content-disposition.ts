/** RFC 5987 percent-encoding: `encodeURIComponent` plus the characters it leaves alone that the header may not carry. */
function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * A `Content-Disposition` header naming `fileName`: an ASCII `filename` for
 * old clients (`fallback` when nothing printable is left) and the exact name
 * as UTF-8 in `filename*`.
 */
export function contentDisposition(disposition: "inline" | "attachment", fileName: string, fallback: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || fallback;
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}
