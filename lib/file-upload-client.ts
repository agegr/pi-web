import { buildAtMentionsText } from "./file-fuzzy";
import { encodeFilePathForApi } from "./file-paths";

/** Browser side of `POST /api/files/[...path]?type=upload`; mirrors `lib/file-upload.ts`. */
export type UploadConflictStrategy = "error" | "overwrite" | "skip";

export interface UploadError {
  name: string;
  error: string;
}

export interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

/**
 * One file of an upload and its path inside the target folder: its name, or
 * `folder/sub/name` for a file of an uploaded folder (`/`-separated).
 */
export interface UploadItem {
  file: File;
  path: string;
}

/** What one upload may total, checked here before anything is sent; the server checks it too. */
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;

export function uploadTotalBytes(items: readonly UploadItem[]): number {
  return items.reduce((total, item) => total + item.file.size, 0);
}

/** Files written under their own names. */
export function fileUploadItems(files: readonly File[]): UploadItem[] {
  return files.map((file) => ({ file, path: file.name }));
}

/** `.DS_Store`, `.git`: entries an uploaded folder leaves out. */
export function isHiddenEntryName(name: string): boolean {
  return name.startsWith(".");
}

/**
 * The files of a folder chosen with `<input webkitdirectory>`, at their
 * `webkitRelativePath` (which starts with the chosen folder). Dot entries
 * inside it are left out; the folder itself is the user's choice.
 */
export function pickedFolderItems(files: readonly File[]): UploadItem[] {
  const items: UploadItem[] = [];
  for (const file of files) {
    const relative = file.webkitRelativePath || file.name;
    if (relative.split("/").slice(1).some(isHiddenEntryName)) continue;
    items.push({ file, path: relative });
  }
  return items;
}

/**
 * Uploads files into one directory through the file API.
 * @param targetDirectory The directory the files are written to
 * @param items The files, each at its path inside that directory
 * @param strategy What the server does with a path that already exists
 * @param onProgress Upload progress in percent, when the browser reports it
 * @returns The HTTP status and the parsed response body
 */
export function uploadFiles(
  targetDirectory: string,
  items: readonly UploadItem[],
  strategy: UploadConflictStrategy,
  onProgress?: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    for (const item of items) formData.append("files", item.file, item.file.name);
    for (const item of items) formData.append("paths", item.path);

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

/** The parts of the File and Directory Entries API a dropped folder is read with. */
export interface DroppedEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
export interface DroppedFileEntry extends DroppedEntry {
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
}
export interface DroppedFolderEntry extends DroppedEntry {
  createReader(): { readEntries(success: (entries: DroppedEntry[]) => void, failure?: (error: unknown) => void): void };
}

/** One file or folder dropped onto the chat or the explorer. */
export type DroppedItem = { kind: "file"; file: File } | { kind: "folder"; name: string; entry: DroppedFolderEntry };

/**
 * Every file below a dropped folder, at `folder/…/name`. Dot entries are left
 * out. A reader answers in batches (Chrome: 100) until an empty one.
 */
export async function readDroppedFolder(entry: DroppedFolderEntry, prefix = entry.name): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) {
      if (isHiddenEntryName(child.name)) continue;
      const childPath = `${prefix}/${child.name}`;
      if (child.isDirectory) {
        items.push(...await readDroppedFolder(child as DroppedFolderEntry, childPath));
      } else if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) => (child as DroppedFileEntry).file(resolve, reject));
        items.push({ file, path: childPath });
      }
    }
  }
  return items;
}

/** A drop read into upload items, with the folders that held nothing to upload or could not be read. */
export interface CollectedUpload {
  items: UploadItem[];
  empty: string[];
  failed: UploadError[];
}

/** Reads a drop's files and folders, in drop order. */
export async function collectDroppedItems(dropped: readonly DroppedItem[]): Promise<CollectedUpload> {
  const result: CollectedUpload = { items: [], empty: [], failed: [] };
  for (const item of dropped) {
    if (item.kind === "file") {
      result.items.push({ file: item.file, path: item.file.name });
      continue;
    }
    try {
      const files = await readDroppedFolder(item.entry);
      if (files.length === 0) result.empty.push(item.name);
      result.items.push(...files);
    } catch (error) {
      result.failed.push({ name: item.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/**
 * Sorts a chat drop: images are attached to the prompt as before; other
 * files and folders are uploaded into the working directory and mentioned.
 * @param items The dropped items, in drop order
 * @returns The images, and the files and folders to upload
 */
export function splitDroppedItems(items: DroppedItem[]): { images: File[]; uploads: DroppedItem[] } {
  const images: File[] = [];
  const uploads: DroppedItem[] = [];
  for (const item of items) {
    if (item.kind === "file" && item.file.type.startsWith("image/")) images.push(item.file);
    else uploads.push(item);
  }
  return { images, uploads };
}

/**
 * The entries an upload adds to its folder's listing, in upload order: a
 * file, or the top folder of a file uploaded inside one.
 * @param paths Upload paths, as the server lists them
 */
export function uploadTopEntries(paths: readonly string[]): Array<{ path: string; isDir: boolean }> {
  const seen = new Set<string>();
  const entries: Array<{ path: string; isDir: boolean }> = [];
  for (const uploadPath of paths) {
    const slash = uploadPath.indexOf("/");
    const top = slash === -1 ? uploadPath : uploadPath.slice(0, slash);
    if (seen.has(top)) continue;
    seen.add(top);
    entries.push({ path: top, isDir: slash !== -1 });
  }
  return entries;
}

/**
 * The `@` mentions for what a drop put in the working directory, in drop
 * order: a file, or a dropped folder (`@folder/`) rather than each of its files.
 * @param items The dropped files
 * @param present Paths the upload reports as written or already there
 * @returns Mentions ready to insert, or an empty string
 */
export function dropMentionText(items: readonly UploadItem[], present: string[]): string {
  const paths = new Set(present);
  return buildAtMentionsText(uploadTopEntries(items.filter((item) => paths.has(item.path)).map((item) => item.path)));
}

/**
 * Names for a notice, at most `limit` of them: a folder's upload can list
 * thousands of paths.
 * @param more Says how many were left out
 */
export function summarizeNames(names: readonly string[], more: (count: number) => string, limit = 5): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} ${more(names.length - limit)}`;
}
