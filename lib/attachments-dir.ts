import fs from "fs";
import os from "os";
import path from "path";

/** Persistent location for uploaded attachments (~/.local/share/pi-web/attachments). */
export function getAttachmentsDir(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "pi-web", "attachments");
}

export function ensureAttachmentsDir(): string {
  const dir = getAttachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
