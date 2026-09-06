import type { FileVersion } from "@/lib/file-version";
import { normalizeFilePathSlashes } from "@/lib/file-paths";

export interface CachedTextFileData {
  content: string;
  language: string;
  size: number;
  version: FileVersion;
}

interface CacheEntry {
  data: CachedTextFileData;
  bytes: number;
}

export function textFileCacheKey(filePath: string, sourceSessionId?: string | null): string {
  return [
    "text-v1",
    normalizeFilePathSlashes(filePath),
    sourceSessionId ?? "<root-authorized>",
  ].join("\0");
}

export class TextFileContentCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): CachedTextFileData | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.data;
  }

  set(key: string, data: CachedTextFileData): void {
    const bytes = data.content.length * 2 + 256;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes -= previous.bytes;
    }
    if (bytes > this.maxBytes || this.maxEntries <= 0 || this.maxBytes <= 0) return;

    this.entries.set(key, { data, bytes });
    this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.totalBytes };
  }
}

const textFileContentCache = new TextFileContentCache(24, 4 * 1024 * 1024);

export function getCachedTextFile(key: string): CachedTextFileData | undefined {
  return textFileContentCache.get(key);
}

export function setCachedTextFile(key: string, data: CachedTextFileData): void {
  textFileContentCache.set(key, data);
}

export function invalidateCachedTextFile(key: string): void {
  textFileContentCache.delete(key);
}
