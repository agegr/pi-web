import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAgentImages, type Base64ImageAttachment } from "./image-attachments";

export const IMAGE_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 60 * 1000;
const OWNER_DIRECTORY = /^pi-web-clipboard-v1-([1-9]\d*)-[a-zA-Z0-9]{6}$/;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
  "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif",
  "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/x-ms-bmp": "bmp",
};

export interface MaterializedImages {
  paths: string[];
  rollback: () => Promise<void>;
}

type AgentImageAttachment = Base64ImageAttachment & { type: "image" };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission errors and other unexpected failures must not count as process exit.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class ImageAttachmentStore {
  private readonly root: string;
  private readonly now: () => number;
  private readonly isBusy: () => boolean;
  private readonly isProcessAlive: (pid: number) => boolean;
  private directory?: string;
  private lastActivity: number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: {
    root?: string;
    now?: () => number;
    isBusy?: () => boolean;
    isProcessAlive?: (pid: number) => boolean;
  } = {}) {
    this.root = options.root ?? tmpdir();
    this.now = options.now ?? Date.now;
    this.isBusy = options.isBusy ?? (() => false);
    this.isProcessAlive = options.isProcessAlive ?? isProcessAlive;
    this.lastActivity = this.now();
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    // Cleanup, rollback and writes share one queue so async deletion cannot race a new batch write.
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }

  materialize(images: AgentImageAttachment[]): Promise<MaterializedImages> {
    return this.exclusive(async () => {
      const error = validateAgentImages(images);
      if (error) throw new Error(error);
      const extensions = images.map(image => {
        const extension = MIME_EXTENSIONS[image.mimeType];
        if (!extension) throw new Error(`Unsupported image MIME type: ${image.mimeType}`);
        return extension;
      });
      this.touch();
      if (!images.length) return { paths: [], rollback: async () => {} };
      if (!this.directory) {
        await this.collectOrphans();
        this.directory = await fs.mkdtemp(join(this.root, `pi-web-clipboard-v1-${process.pid}-`));
        await fs.chmod(this.directory, 0o700);
      }
      const batch = await fs.mkdtemp(join(this.directory, "batch-"));
      const paths: string[] = [];
      try {
        await fs.chmod(batch, 0o700);
        for (let index = 0; index < images.length; index++) {
          const path = join(batch, `pi-web-clipboard-${randomUUID()}.${extensions[index]}`);
          await fs.writeFile(path, Buffer.from(images[index].data, "base64"), { mode: 0o600, flag: "wx" });
          paths.push(path);
        }
      } catch (error) {
        await fs.rm(batch, { recursive: true, force: true }).catch(reportCleanupError);
        throw error;
      }
      this.touch();
      return {
        paths,
        rollback: () => this.exclusive(() => fs.rm(batch, { recursive: true, force: true })),
      };
    });
  }

  collect(): Promise<void> {
    return this.exclusive(async () => {
      if (this.isBusy()) this.touch();
      if (this.directory && this.now() - this.lastActivity >= IMAGE_IDLE_TTL_MS) {
        await fs.rm(this.directory, { recursive: true, force: true });
        this.directory = undefined;
      }
      await this.collectOrphans();
    });
  }

  private async collectOrphans(): Promise<void> {
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      const match = OWNER_DIRECTORY.exec(entry.name);
      if (!entry.isDirectory() || !match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || this.isProcessAlive(pid)) continue;
      const path = join(this.root, entry.name);
      try {
        const stat = await fs.lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        if (process.getuid && stat.uid !== process.getuid()) continue;
        if (this.now() - stat.mtimeMs < IMAGE_IDLE_TTL_MS) continue;
        await fs.rm(path, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") reportCleanupError(error);
      }
    }
  }

  disposeSync(): void {
    if (!this.directory) return;
    rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}

function reportCleanupError(error: unknown): void {
  console.error("[pi-web] image attachment cleanup failed:", error);
}

export function appendImagePaths(message: string, paths: string[]): string {
  if (!paths.length) return message;
  // The space preserves the SDK's split-on-first-space /command behavior; JSON quoting keeps
  // newlines inside a path from confusing the annotation.
  return `${message} \n\n[Attached image files on this server (temporary):\n${paths.map((path, index) => `${index + 1}. ${JSON.stringify(path)}`).join("\n")}\nThe same images are also included as image inputs. Use these paths for file/image tools.]`;
}

declare global {
  var __piImageAttachmentStore: ImageAttachmentStore | undefined;
}

export function getImageAttachmentStore(isBusy: () => boolean): ImageAttachmentStore {
  if (!globalThis.__piImageAttachmentStore) {
    const store = new ImageAttachmentStore({ isBusy });
    globalThis.__piImageAttachmentStore = store;
    const timer = setInterval(() => { void store.collect().catch(reportCleanupError); }, GC_INTERVAL_MS);
    timer.unref();
    process.once("exit", () => {
      clearInterval(timer);
      try { store.disposeSync(); } catch (error) { reportCleanupError(error); }
    });
  }
  return globalThis.__piImageAttachmentStore;
}
