import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  bufferReader,
  fontDirectories,
  listInstalledFonts,
  mergeFontFaces,
  parseFontFaces,
  readInstalledFonts,
} = await jiti.import("./installed-fonts.ts");

/** name table: one record per (platform, language, nameID), UTF-16BE like a real Windows font. */
function nameTable(records) {
  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(6 + records.length * 12, 4);
  const strings = [];
  let offset = 0;
  records.forEach((record, index) => {
    const bytes = Buffer.alloc(record.text.length * 2);
    for (let at = 0; at < record.text.length; at += 1) bytes.writeUInt16BE(record.text.charCodeAt(at), at * 2);
    const position = 6 + index * 12;
    header.writeUInt16BE(record.platformID ?? 3, position);
    header.writeUInt16BE(1, position + 2);
    header.writeUInt16BE(record.languageID ?? 0x0409, position + 4);
    header.writeUInt16BE(record.nameID, position + 6);
    header.writeUInt16BE(bytes.length, position + 8);
    header.writeUInt16BE(offset, position + 10);
    strings.push(bytes);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...strings]);
}

function postTable(fixedPitch) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(0x00030000, 0);
  buffer.writeUInt32BE(fixedPitch ? 1 : 0, 12);
  return buffer;
}

/** A one-face sfnt: a table directory plus the two tables the reader looks at. */
function buildFace({ names, fixedPitch = false }) {
  const tables = [["name", nameTable(names)], ["post", postTable(fixedPitch)]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const header = Buffer.alloc(12 + tables.length * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(tables.length, 4);
  const chunks = [header];
  let offset = header.length;
  tables.forEach(([tag, data], index) => {
    const record = 12 + index * 16;
    header.write(tag, record, "latin1");
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(data.length, record + 12);
    chunks.push(data);
    offset += data.length;
  });
  return Buffer.concat(chunks);
}

/** A font collection: each face's table offsets are absolute, as a real .ttc writes them. */
function buildCollection(faces) {
  const header = Buffer.alloc(12 + faces.length * 4);
  header.write("ttcf", 0, "latin1");
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(faces.length, 8);
  const chunks = [header];
  let offset = header.length;
  faces.forEach((face, index) => {
    header.writeUInt32BE(offset, 12 + index * 4);
    chunks.push(face);
    offset += face.length;
  });
  const collection = Buffer.concat(chunks);
  faces.forEach((face, index) => {
    const base = header.length + faces.slice(0, index).reduce((total, previous) => total + previous.length, 0);
    const tables = face.readUInt16BE(4);
    for (let record = 0; record < tables; record += 1) {
      const at = base + 12 + record * 16 + 8;
      collection.writeUInt32BE(collection.readUInt32BE(at) + base, at);
    }
  });
  return collection;
}

function facesOf(buffer) {
  return parseFontFaces(bufferReader(buffer));
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-fonts-")));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("reads the English family, its localized alias and the fixed-pitch flag", () => {
  const [face] = facesOf(buildFace({
    names: [
      { nameID: 1, text: "Test Sans" },
      { nameID: 1, languageID: 0x0804, text: "霞鹜文楷" },
    ],
  }));
  assert.equal(face.family, "Test Sans");
  assert.deepEqual(face.aliases, ["霞鹜文楷"]);
  assert.equal(face.monospace, false);

  const [mono] = facesOf(buildFace({
    names: [{ nameID: 1, text: "Test Sans" }],
    fixedPitch: true,
  }));
  assert.equal(mono.monospace, true);
});

test("keeps the typographic family over a weight-specific legacy one", () => {
  const [face] = facesOf(buildFace({
    names: [
      { nameID: 1, text: "Test Sans Medium" },
      { nameID: 16, text: "Test Sans" },
    ],
  }));
  assert.equal(face.family, "Test Sans");
  assert.deepEqual(face.aliases, []);
});

test("drops Windows' vertical aliases and hidden faces", () => {
  const [face] = facesOf(buildFace({
    names: [
      { nameID: 1, text: "Test Sans" },
      { nameID: 1, text: "@Test Sans" },
      { nameID: 1, text: ".Hidden Fallback" },
    ],
  }));
  assert.equal(face.family, "Test Sans");
  assert.deepEqual(face.aliases, []);

  assert.deepEqual(facesOf(buildFace({ names: [{ nameID: 1, text: "@Only Vertical" }] })), []);
});

test("reads every face of a collection and merges the weights of one family", () => {
  const collection = buildCollection([
    buildFace({ names: [{ nameID: 1, text: "Test Mono" }], fixedPitch: true }),
    buildFace({ names: [{ nameID: 1, text: "Test Serif" }] }),
  ]);
  assert.deepEqual(facesOf(collection).map((face) => face.family), ["Test Mono", "Test Serif"]);

  const merged = mergeFontFaces([
    { family: "Test Sans", aliases: [], monospace: false },
    { family: "Test Sans", aliases: ["霞鹜文楷"], monospace: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].monospace, true);
  assert.deepEqual(merged[0].aliases, ["霞鹜文楷"]);
});

test("an unreadable file is skipped instead of failing the whole list", () => {
  const dir = path.join(root, "unreadable");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "broken.ttf"), "not a font");
  fs.writeFileSync(path.join(dir, "real.ttf"), buildFace({ names: [{ nameID: 1, text: "Test Sans" }] }));
  fs.writeFileSync(path.join(dir, "ignored.txt"), "not a font either");

  const fonts = readInstalledFonts([dir]);
  assert.deepEqual(fonts.map((font) => font.family), ["Test Sans"]);
});

test("lists a directory tree and re-scans only after the cache expires", async () => {
  const dir = path.join(root, "tree");
  fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
  fs.writeFileSync(path.join(dir, "nested", "one.ttf"), buildFace({ names: [{ nameID: 1, text: "Test One" }] }));

  const start = 1_000_000;
  const first = await listInstalledFonts({ dirs: [dir], now: start });
  assert.deepEqual(first.map((font) => font.family), ["Test One"]);

  // A font installed while pi-web runs shows up on the next read, not this one.
  fs.writeFileSync(path.join(dir, "two.ttf"), buildFace({ names: [{ nameID: 1, text: "Test Two" }] }));
  const cached = await listInstalledFonts({ dirs: [dir], now: start + 60_000 });
  assert.deepEqual(cached.map((font) => font.family), ["Test One"]);

  const rescanned = await listInstalledFonts({ dirs: [dir], now: start + 11 * 60_000 });
  assert.deepEqual(rescanned.map((font) => font.family), ["Test One", "Test Two"]);
});

test("font directories follow the platform, the home directory and PI_WEB_FONT_DIRS", () => {
  // These are folder names, so the separators are the host's: `path.join` builds
  // the expectation the same way the reader does, on every CI platform.
  const windows = fontDirectories("win32", { WINDIR: "D:\\Win" }, "C:\\Users\\me");
  assert.deepEqual(windows, [
    path.join("D:\\Win", "Fonts"),
    path.join("C:\\Users\\me", "AppData", "Local", "Microsoft", "Windows", "Fonts"),
  ]);

  const linux = fontDirectories("linux", {}, "/home/me");
  assert.deepEqual(linux, ["/usr/share/fonts", "/usr/local/share/fonts", path.join("/home/me", ".local", "share", "fonts"), path.join("/home/me", ".fonts")]);

  const override = fontDirectories("win32", { PI_WEB_FONT_DIRS: ["first", "second"].join(path.delimiter) }, "/home/me");
  assert.deepEqual(override, ["first", "second"]);
});

test("this machine's fonts are readable and each family has a name", () => {
  const dirs = fontDirectories();
  if (!dirs.some((dir) => fs.existsSync(dir))) return;
  const fonts = readInstalledFonts(dirs);
  assert.ok(fonts.length > 0, "no font family read from an existing font directory");
  for (const font of fonts) {
    assert.ok(font.family.trim().length > 0);
    assert.equal(typeof font.monospace, "boolean");
    assert.ok(Array.isArray(font.aliases));
  }
});
