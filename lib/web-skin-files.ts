import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { isExistingPathWithinRoots } from "./path-security";
import { isWebSkinId, parseWebSkinManifest, type WebSkin } from "./web-skin";

const MANIFEST_LIMIT = 32 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0);

/** Explicit server-side opt-in. No config means no filesystem reads. */
function rootDirectory(configured: string | undefined): string | null {
  if (!configured || !path.isAbsolute(configured)) return null;
  try { return realpathSync(configured); } catch { return null; }
}
function packDirectory(root: string, id: string): string | null {
  if (!isWebSkinId(id)) return null;
  const directory = path.join(root, id);
  if (!isExistingPathWithinRoots(directory, new Set([root]))) return null;
  try {
    if (!lstatSync(directory).isDirectory()) return null; // no linked pack directories
    return realpathSync(directory);
  } catch { return null; }
}
/** Bound both the opened object and bytes actually read, including files growing mid-read. */
function readPackFile(directory: string, name: string, limit: number): Buffer {
  const filename = path.join(directory, name);
  if (!isExistingPathWithinRoots(filename, new Set([directory])) || !lstatSync(filename).isFile()) throw new Error("Invalid skin file");
  const fd = openSync(filename, FLAGS);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("Invalid skin file");
    const out = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < out.length) {
      const count = readSync(fd, out, length, out.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error("Skin file too large");
    return out.subarray(0, length);
  } finally { closeSync(fd); }
}
function readSkin(root: string, id: string): WebSkin | null {
  try {
    const directory = packDirectory(root, id);
    if (!directory) return null;
    const manifest = parseWebSkinManifest(JSON.parse(readPackFile(directory, "skin.json", MANIFEST_LIMIT).toString("utf8")));
    return manifest ? { id, ...manifest } : null;
  } catch { return null; }
}
/** Catalog reads declarations only. Background image bytes are not read here. */
export function listWebSkins(configured = process.env.PI_WEB_SKINS_DIR): WebSkin[] {
  const root = rootDirectory(configured);
  if (!root) return [];
  try {
    const directory = opendirSync(root);
    const ids: string[] = [];
    try {
      for (let i = 0; i < 256; i++) {
        const entry = directory.readSync();
        if (!entry) break;
        if (entry.isDirectory() && isWebSkinId(entry.name)) ids.push(entry.name);
      }
    } finally { directory.closeSync(); }
    return ids.sort().slice(0, 100).flatMap((id) => {
      const skin = readSkin(root, id);
      return skin ? [skin] : [];
    });
  } catch { return []; }
}
/** Serve only the PNG declared by a currently valid, installed skin. No browser path input. */
export function readWebSkinBackground(id: string, configured = process.env.PI_WEB_SKINS_DIR): Buffer | null {
  const root = rootDirectory(configured);
  if (!root) return null;
  try {
    const skin = readSkin(root, id);
    const directory = packDirectory(root, id);
    if (!skin?.background || !directory) return null;
    const bytes = readPackFile(directory, skin.background.file, IMAGE_LIMIT);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii",12,16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) return null;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) return null;
    return bytes;
  } catch { return null; }
}
