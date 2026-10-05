"use client";

import { buildAtMentionText } from "./file-fuzzy";
import { encodeFilePathForApi } from "./file-paths";

export interface DroppedFile {
  file: File;
  /** POSIX path relative to the drop root; first segment is the root name. */
  relativePath: string;
}

export interface DroppedRoot {
  name: string;
  isDir: boolean;
}

export interface DropRootResult {
  original: string;
  final: string;
  isDir: boolean;
}

export interface DropUploadResponse {
  roots?: DropRootResult[];
  uploaded?: string[];
  skipped?: string[];
  errors?: Array<{ name: string; error: string }>;
  error?: string;
}

/** Guard against runaway recursive drops. */
const MAX_DROP_FILES = 2000;

function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: DroppedFile[]): Promise<void> {
  if (out.length >= MAX_DROP_FILES) return;
  if (entry.isFile) {
    const file = await fileEntryToFile(entry as FileSystemFileEntry);
    out.push({ file, relativePath: `${prefix}${file.name}` });
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
  for (const child of children) {
    await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Map a dropped file's name to its original parent directory name, recovered
 * from a `text/uri-list` payload when the browser provides one. Browsers hide
 * absolute paths for privacy, so this is best-effort only.
 */
export function parseUriDirectories(uriList: string): Map<string, string> {
  const byName = new Map<string, string>();
  if (!uriList) return byName;
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let pathname = trimmed;
    if (trimmed.startsWith("file://")) {
      try {
        pathname = new URL(trimmed).pathname;
      } catch {
        continue;
      }
    } else if (!trimmed.startsWith("/")) {
      continue;
    }
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // keep the raw form when the payload is not valid percent-encoding
    }
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length < 2) continue;
    const name = segments[segments.length - 1];
    const parent = segments[segments.length - 2];
    if (!byName.has(name)) byName.set(name, parent);
  }
  return byName;
}

/**
 * Flatten a drop's entries (and loose files) into a list of files with relative
 * paths. Falls back to the loose `File` list when the browser gives no entries.
 */
export async function collectDroppedItems(
  entries: (FileSystemEntry | null)[],
  looseFiles: File[],
  uriList = "",
): Promise<{ files: DroppedFile[]; roots: DroppedRoot[] }> {
  const files: DroppedFile[] = [];
  const roots: DroppedRoot[] = [];
  const usableEntries = entries.filter((entry): entry is FileSystemEntry => entry !== null);

  if (usableEntries.length === 0) {
    const dirByName = parseUriDirectories(uriList);
    for (const file of looseFiles) {
      // Prefer the browser-reported path, then the recovered original parent
      // directory; otherwise only the bare name is available.
      let relativePath = file.webkitRelativePath || file.name;
      if (!file.webkitRelativePath) {
        const parent = dirByName.get(file.name);
        if (parent) relativePath = `${parent}/${file.name}`;
      }
      files.push({ file, relativePath });
      const segments = relativePath.split("/");
      if (segments.length > 1) {
        roots.push({ name: segments[0], isDir: true });
      } else {
        roots.push({ name: relativePath, isDir: false });
      }
    }
    return { files, roots };
  }

  for (const entry of usableEntries) {
    if (entry.isDirectory) {
      roots.push({ name: entry.name, isDir: true });
      await walkEntry(entry, "", files);
    } else if (entry.isFile) {
      const file = await fileEntryToFile(entry as FileSystemFileEntry);
      files.push({ file, relativePath: file.name });
      roots.push({ name: file.name, isDir: false });
    }
  }

  return { files, roots };
}

/**
 * Copy dropped items into the session working directory, preserving folder
 * structure, and return the paths the server actually wrote.
 */
export async function uploadDroppedItems(
  cwd: string,
  files: DroppedFile[],
  roots: DroppedRoot[],
): Promise<DropUploadResponse> {
  const formData = new FormData();
  for (const item of files) {
    const fileName = item.relativePath.split("/").pop() || item.file.name;
    formData.append("files", item.file, fileName);
  }
  formData.append("paths", JSON.stringify(files.map((item) => item.relativePath)));
  formData.append("roots", JSON.stringify(roots));

  let response: Response;
  try {
    response = await fetch(`/api/files/${encodeFilePathForApi(cwd)}?type=drop`, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  let data: DropUploadResponse = {};
  try {
    data = (await response.json()) as DropUploadResponse;
  } catch {
    data = {};
  }
  if (!response.ok && !data.error) data.error = `HTTP ${response.status}`;
  return data;
}

/** Cap the number of file mentions so one huge folder cannot flood the draft. */
export const MAX_DROP_MENTIONS = 100;

/**
 * Build the `@mention` text for everything that was actually written.
 *
 * Pi does not expand `@` tokens itself, so each dropped file is referenced by
 * its full cwd-relative path (directories included). That way the model can
 * open the file directly instead of searching for a bare filename. Empty
 * folders (and, past the cap, each root folder) are referenced as directories.
 */
export function buildDropMentions(
  uploaded: string[] | undefined,
  roots: DropRootResult[] | undefined,
  maxMentions: number = MAX_DROP_MENTIONS,
): string {
  const files = uploaded ?? [];
  const rootList = roots ?? [];
  const directories = rootList.filter((root) => root.isDir);
  const shown = files.slice(0, maxMentions);
  const overflow = files.length > shown.length;

  const mentions = shown.map((file) => buildAtMentionText(file, false));

  // Folders that received no files still deserve a reference.
  for (const dir of directories) {
    if (!files.some((file) => file.startsWith(`${dir.final}/`))) {
      mentions.push(buildAtMentionText(dir.final, true));
    }
  }

  // When the file list is truncated, fall back to the root folders as well so
  // the remaining files are still reachable.
  if (overflow) {
    for (const dir of directories) {
      mentions.push(buildAtMentionText(dir.final, true));
    }
  }

  return mentions.join("");
}
