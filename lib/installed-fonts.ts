import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { InstalledFontInfo } from "./api-types";

/**
 * Reads the font families installed on the machine running pi-web, so the
 * settings panel can offer them in a picker instead of asking for a family
 * name the user has to look up somewhere else. Only the `name` and `post`
 * tables are read, never a whole font file.
 */

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);
const MAX_DEPTH = 4;
const MAX_FILES = 4000;
const MAX_FAMILIES = 2000;
/** A name table is a few KB; anything far bigger is not a font we can list. */
const MAX_NAME_TABLE = 1 << 20;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Fixed pitch that a family name alone proves, for fonts that do not set `post.isFixedPitch`. */
const MONOSPACE_NAME = /mono|code|consol|courier|menlo|monaco|terminal|等宽|等寬|fixed/i;

interface TableRecord {
  offset: number;
  length: number;
}

interface FontReader {
  size: number;
  read(offset: number, length: number): Buffer | null;
}

interface FontFileReader extends FontReader {
  dispose(): void;
}

export interface FontFace {
  /** The name a CSS font-family resolves, in its English spelling when the font has one. */
  family: string;
  /** The same family's other names (localized ones such as 霞鹜文楷), for search and display. */
  aliases: string[];
  monospace: boolean;
}

export function bufferReader(buffer: Buffer): FontReader {
  return {
    size: buffer.length,
    read: (offset, length) => (
      offset < 0 || length <= 0 || offset + length > buffer.length ? null : buffer.subarray(offset, offset + length)
    ),
  };
}

function fileReader(pathname: string): FontFileReader | null {
  let size: number;
  try {
    size = statSync(pathname).size;
  } catch {
    return null;
  }
  let fd: number;
  try {
    fd = openSync(pathname, "r");
  } catch {
    return null;
  }
  return {
    size,
    read: (offset, length) => {
      if (offset < 0 || length <= 0 || offset + length > size) return null;
      const buffer = Buffer.allocUnsafe(length);
      try {
        return readSync(fd, buffer, 0, length, offset) === length ? buffer : null;
      } catch {
        return null;
      }
    },
    // One file is one read session, not a long-lived handle.
    dispose: () => closeSync(fd),
  };
}

/** Table directory of one face; `null` when the file is not a font we can read. */
function readTableDirectory(reader: FontReader, base: number): Map<string, TableRecord> | null {
  const header = reader.read(base, 12);
  if (!header) return null;
  const numTables = header.readUInt16BE(4);
  if (!numTables || numTables > 1024) return null;
  const directory = reader.read(base, 12 + numTables * 16);
  if (!directory) return null;
  const tables = new Map<string, TableRecord>();
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    const tag = directory.toString("latin1", record, record + 4);
    const offset = directory.readUInt32BE(record + 8);
    const length = directory.readUInt32BE(record + 12);
    if (!offset || !length || offset + length > reader.size) continue;
    tables.set(tag, { offset, length });
  }
  return tables;
}

/** Offsets of every face in the file: one for a font, several for a collection. */
function faceOffsets(reader: FontReader): number[] {
  const header = reader.read(0, 12);
  if (!header) return [];
  if (header.toString("latin1", 0, 4) !== "ttcf") return [0];
  const numFonts = header.readUInt32BE(8);
  if (!numFonts || numFonts > 256) return [];
  const list = reader.read(12, numFonts * 4);
  if (!list) return [];
  const offsets: number[] = [];
  for (let index = 0; index < numFonts; index += 1) offsets.push(list.readUInt32BE(index * 4));
  return offsets;
}

function decodeName(bytes: Buffer, platformID: number): string {
  if (platformID === 0 || platformID === 3) {
    if (bytes.length % 2) return "";
    let text = "";
    for (let index = 0; index < bytes.length; index += 2) text += String.fromCharCode(bytes.readUInt16BE(index));
    return text;
  }
  // Platform 1 (Macintosh) is MacRoman; its lower half is ASCII, which is all a
  // family name needs here.
  return bytes.toString("latin1");
}

interface NameRecord {
  nameID: number;
  platformID: number;
  languageID: number;
  text: string;
}

function readNameRecords(reader: FontReader, table: TableRecord): NameRecord[] {
  const data = reader.read(table.offset, Math.min(table.length, MAX_NAME_TABLE));
  if (!data || data.length < 6) return [];
  const count = data.readUInt16BE(2);
  const storage = data.readUInt16BE(4);
  if (count > 4096) return [];
  const records: NameRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    if (record + 12 > data.length) break;
    const platformID = data.readUInt16BE(record);
    const languageID = data.readUInt16BE(record + 4);
    const nameID = data.readUInt16BE(record + 6);
    // 1 is the legacy family, 16 the typographic one that groups every weight.
    if (nameID !== 1 && nameID !== 16) continue;
    const length = data.readUInt16BE(record + 8);
    const offset = storage + data.readUInt16BE(record + 10);
    if (!length || offset + length > data.length) continue;
    const text = decodeName(data.subarray(offset, offset + length), platformID)
      .replace(/[\u0000-\u001f]/g, "")
      .trim();
    // "@" names are Windows' vertical-writing aliases; "." names are hidden faces.
    if (!text || text.length > 200 || /^[@.]/.test(text)) continue;
    records.push({ nameID, platformID, languageID, text });
  }
  return records;
}

function isEnglish(record: NameRecord): boolean {
  return (record.platformID === 3 && record.languageID === 0x0409) || (record.platformID === 1 && record.languageID === 0);
}

function isFixedPitch(reader: FontReader, tables: Map<string, TableRecord>): boolean {
  const post = tables.get("post");
  if (!post) return false;
  const data = reader.read(post.offset, 16);
  return Boolean(data && data.readUInt32BE(12));
}

/** One face's family names and pitch. `base` is the face's offset inside a collection. */
export function parseFace(reader: FontReader, base = 0): FontFace | null {
  const tables = readTableDirectory(reader, base);
  const nameTable = tables?.get("name");
  if (!tables || !nameTable) return null;
  const records = readNameRecords(reader, nameTable);
  if (!records.length) return null;

  // The typographic family (16) groups the weights a legacy family (1) splits
  // apart, so it wins per language; English leads, the rest become aliases.
  const byLanguage = new Map<string, { text: string; english: boolean }>();
  for (const record of records) {
    const key = `${record.platformID}:${record.languageID}`;
    const existing = byLanguage.get(key);
    if (existing && (existing.text === record.text || (record.nameID === 1 && records.some((other) => (
      other.nameID === 16 && other.platformID === record.platformID && other.languageID === record.languageID
    ))))) continue;
    byLanguage.set(key, { text: record.text, english: isEnglish(record) });
  }
  const names = [...byLanguage.values()].filter((entry) => entry.text);
  const primary = (names.find((entry) => entry.english) ?? names[0])?.text;
  if (!primary) return null;
  const aliases = [...new Set(names.map((entry) => entry.text))].filter((name) => name !== primary);

  return {
    family: primary,
    aliases,
    monospace: isFixedPitch(reader, tables) || MONOSPACE_NAME.test(primary),
  };
}

/** Every face of a font file, or of each font inside a collection. */
export function parseFontFaces(reader: FontReader): FontFace[] {
  const faces: FontFace[] = [];
  for (const base of faceOffsets(reader)) {
    const face = parseFace(reader, base);
    if (face) faces.push(face);
  }
  return faces;
}

/** Merges the weights and localized names of one family, keeping it monospace if any face is. */
export function mergeFontFaces(faces: FontFace[]): FontFace[] {
  const byFamily = new Map<string, FontFace & { names: Set<string> }>();
  for (const face of faces) {
    const key = face.family.toLocaleLowerCase();
    const existing = byFamily.get(key);
    if (existing) {
      existing.monospace ||= face.monospace;
      for (const name of [face.family, ...face.aliases]) existing.names.add(name);
    } else {
      byFamily.set(key, { ...face, names: new Set([face.family, ...face.aliases]) });
    }
  }
  return [...byFamily.values()]
    .map(({ names, ...face }) => ({ ...face, aliases: [...names].filter((name) => name !== face.family) }))
    .sort((a, b) => a.family.localeCompare(b.family, "en", { sensitivity: "base" }));
}

function collectFontFiles(dir: string, files: string[], depth = 0): void {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFontFiles(full, files, depth + 1);
    else if (FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
}

/** Where each platform keeps fonts; `PI_WEB_FONT_DIRS` overrides it for tests and containers. */
export function fontDirectories(platform = process.platform, env = process.env, home = homedir()): string[] {
  if (env.PI_WEB_FONT_DIRS) return env.PI_WEB_FONT_DIRS.split(path.delimiter).filter(Boolean);
  if (platform === "win32") {
    const windows = env.WINDIR || env.SystemRoot || "C:\\Windows";
    return [
      path.join(windows, "Fonts"),
      path.join(home, "AppData", "Local", "Microsoft", "Windows", "Fonts"),
    ];
  }
  if (platform === "darwin") {
    return [
      "/System/Library/Fonts",
      "/System/Library/Fonts/Supplemental",
      "/Library/Fonts",
      path.join(home, "Library", "Fonts"),
    ];
  }
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path.join(home, ".local", "share", "fonts"),
    path.join(home, ".fonts"),
  ];
}

const cache = new Map<string, { at: number; fonts: InstalledFontInfo[] }>();

/** Drops the cached list; a font installed while pi-web runs shows up on the next read. */
export function clearInstalledFontsCache(): void {
  cache.clear();
}

export function readInstalledFonts(dirs: string[]): InstalledFontInfo[] {
  const faces: FontFace[] = [];
  for (const dir of dirs) {
    const files: string[] = [];
    collectFontFiles(dir, files);
    for (const file of files) {
      const reader = fileReader(file);
      if (!reader) continue;
      try {
        faces.push(...parseFontFaces(reader));
      } catch {
        // One unreadable font must not hide the rest.
      } finally {
        reader.dispose();
      }
    }
  }
  return mergeFontFaces(faces).slice(0, MAX_FAMILIES);
}

export async function listInstalledFonts(options: { dirs?: string[]; now?: number } = {}): Promise<InstalledFontInfo[]> {
  const dirs = options.dirs ?? fontDirectories();
  const key = dirs.join("|");
  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.fonts;
  const fonts = readInstalledFonts(dirs);
  cache.set(key, { at: now, fonts });
  return fonts;
}
