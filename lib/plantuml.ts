// A ```plantuml fence renders on the public PlantUML server, only on a click
// (components/PlantUmlBlock.tsx). The diagram travels in the URL in PlantUML's
// own text encoding: https://plantuml.com/text-encoding

export const PLANTUML_SVG_SERVER = "https://www.plantuml.com/plantuml/svg/";

/**
 * Longest URL sent. The server (Tomcat) refuses a request whose request line
 * and headers pass 8 KB with a 400 page: with curl's few headers a 7,424-byte
 * URL rendered and a 7,522-byte one did not (2026-11). A browser sends more
 * headers, so a longer URL is never sent: the server would refuse it anyway,
 * and only the code would have left the page.
 */
export const PLANTUML_MAX_URL_LENGTH = 6000;

/** The fence languages taken as PlantUML: its name and its file extension. */
export function isPlantUmlLang(lang: string): boolean {
  return lang === "plantuml" || lang === "puml";
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** PlantUML's base64: its own alphabet, no padding (a short last group is zero-filled). */
export function encodePlantUmlBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1] ?? 0;
    const b3 = bytes[i + 2] ?? 0;
    out += ALPHABET[b1 >> 2]
      + ALPHABET[((b1 & 0x3) << 4) | (b2 >> 4)]
      + ALPHABET[((b2 & 0xf) << 2) | (b3 >> 6)]
      + ALPHABET[b3 & 0x3f];
  }
  return out;
}

/** The uncompressed form: `~h` and the UTF-8 bytes in hex. */
export function encodePlantUmlHex(bytes: Uint8Array): string {
  let out = "~h";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Raw deflate, or null where the browser has none: `CompressionStream` came
 * in Safari 16.4 (iOS 16.2 has none), and Chrome had it 23 versions before
 * it took "deflate-raw", throwing a TypeError for the format.
 */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const compressed = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  } catch {
    return null;
  }
}

/** The diagram's PlantUML encoding: deflated where the browser can, else hex. */
export async function encodePlantUml(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const deflated = await deflateRaw(bytes);
  return deflated ? encodePlantUmlBase64(deflated) : encodePlantUmlHex(bytes);
}

/** The diagram's SVG on the PlantUML server, or null when the URL would be too long. */
export async function plantUmlSvgUrl(code: string): Promise<string | null> {
  const url = PLANTUML_SVG_SERVER + await encodePlantUml(code);
  return url.length <= PLANTUML_MAX_URL_LENGTH ? url : null;
}
