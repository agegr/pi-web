import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createJiti } from "jiti";

const {
  PLANTUML_MAX_URL_LENGTH,
  PLANTUML_SVG_SERVER,
  encodePlantUml,
  encodePlantUmlBase64,
  encodePlantUmlHex,
  isPlantUmlLang,
  plantUmlSvgUrl,
} = await createJiti(import.meta.url).import("./plantuml.ts");

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** PlantUML's decoder, as its server reads the text back. */
function decode(encoded) {
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const [c1, c2, c3, c4] = [...encoded.slice(i, i + 4)].map((c) => ALPHABET.indexOf(c));
    bytes.push((c1 << 2) | (c2 >> 4), ((c2 & 0xf) << 4) | (c3 >> 2), ((c3 & 0x3) << 6) | c4);
  }
  // The zero-filled tail of a short last group is past the deflate stream's end.
  return inflateRawSync(Buffer.from(bytes)).toString("utf8");
}

async function withCompressionStream(value, fn) {
  const original = globalThis.CompressionStream;
  if (value === undefined) delete globalThis.CompressionStream;
  else globalThis.CompressionStream = value;
  try {
    return await fn();
  } finally {
    globalThis.CompressionStream = original;
  }
}

test("the base64 matches plantuml.com's own example and plantuml-encoder", () => {
  // https://plantuml.com/text-encoding, and plantuml-encoder 1.4.0 (deflate level 9).
  const deflate = (text) => deflateRawSync(Buffer.from(text), { level: 9 });
  assert.equal(encodePlantUmlBase64(deflate("Bob -> Alice : hello")), "SyfFKj2rKt3CoKnELR1Io4ZDoSa70000");
  assert.equal(
    encodePlantUmlBase64(deflate("@startuml\nAlice -> Bob: Hello!\nBob --> Alice: Hi!\n@enduml")),
    "SoWkIImgAStDuNBCoKnELT2rKt3AJx9Iy4ZDoSbNv7BAJrBGrRLJ04jQANXaAd8vfEQbbERc0000",
  );
  assert.equal(
    encodePlantUmlBase64(deflate("@startuml\n用户 -> 系统: 登录 ✓\n@enduml")),
    "0Iu0qVz0StHXSdHrRMmAvvIeveYt82q-8EUpk-UxdpeWvvcxvRsL8EASamf0PMvaTMri",
  );
});

test("the base64 zero-fills a short last group to four characters", () => {
  assert.equal(encodePlantUmlBase64(new Uint8Array([])), "");
  assert.equal(encodePlantUmlBase64(new Uint8Array([0xff])), "_m00");
  assert.equal(encodePlantUmlBase64(new Uint8Array([0xff, 0xff])), "__y0");
  assert.equal(encodePlantUmlBase64(new Uint8Array([0xff, 0xff, 0xff])), "____");
});

test("the hex form is ~h and the UTF-8 bytes", () => {
  const bytes = new TextEncoder().encode("A -> 乙\n");
  assert.equal(encodePlantUmlHex(bytes), "~h41202d3e20e4b9990a");
});

test("encodePlantUml deflates where the browser has deflate-raw", async () => {
  const text = "@startuml\n用户 -> 系统: 登录 ✓\n@enduml";
  const encoded = await encodePlantUml(text);
  assert.match(encoded, /^[0-9A-Za-z_-]+$/);
  assert.equal(decode(encoded), text);
});

test("encodePlantUml falls back to hex without CompressionStream (Safari before 16.4)", async () => {
  const encoded = await withCompressionStream(undefined, () => encodePlantUml("A -> 乙\n"));
  assert.equal(encoded, "~h41202d3e20e4b9990a");
});

test("encodePlantUml falls back to hex where deflate-raw is refused (Chrome before 103)", async () => {
  const Original = globalThis.CompressionStream;
  class OldCompressionStream extends Original {
    constructor(format) {
      if (format === "deflate-raw") throw new TypeError(`Unsupported compression format: '${format}'`);
      super(format);
    }
  }
  const encoded = await withCompressionStream(OldCompressionStream, () => encodePlantUml("A -> 乙\n"));
  assert.equal(encoded, "~h41202d3e20e4b9990a");
});

test("plantUmlSvgUrl points at the SVG endpoint and sends nothing too long", async () => {
  assert.equal(PLANTUML_SVG_SERVER, "https://www.plantuml.com/plantuml/svg/");
  const url = await plantUmlSvgUrl("Bob -> Alice : hello");
  assert.ok(url.startsWith(PLANTUML_SVG_SERVER));
  assert.equal(decode(url.slice(PLANTUML_SVG_SERVER.length)), "Bob -> Alice : hello");

  const fits = "a".repeat((PLANTUML_MAX_URL_LENGTH - PLANTUML_SVG_SERVER.length - 2) / 2);
  await withCompressionStream(undefined, async () => {
    assert.equal((await plantUmlSvgUrl(fits)).length, PLANTUML_MAX_URL_LENGTH);
    assert.equal(await plantUmlSvgUrl(`${fits}a`), null);
  });
});

test("isPlantUmlLang takes plantuml and puml fences only", () => {
  assert.equal(isPlantUmlLang("plantuml"), true);
  assert.equal(isPlantUmlLang("puml"), true);
  for (const lang of ["", "uml", "mermaid", "svg", "plantuml2", "text"]) {
    assert.equal(isPlantUmlLang(lang), false, lang);
  }
});
