import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { SessionIndexEntry } from "./session-index-core.mts";

export function moduleAssetPath(url: URL | string): string {
  const value = String(url);
  const nextAssetPrefix = "/_next/";
  if (value.startsWith(nextAssetPrefix)) {
    return join(
      process.cwd(),
      ".next",
      "server",
      "chunks",
      value.slice(nextAssetPrefix.length),
    );
  }
  return fileURLToPath(value);
}

const SESSION_INDEX_WORKER_PATH = moduleAssetPath(new URL("./session-index-worker.mts", import.meta.url));
const SESSION_INDEX_CORE_PATH = moduleAssetPath(new URL("./session-index-core.mts", import.meta.url));
const SESSION_INDEX_STORE_PATH = moduleAssetPath(new URL("./session-index-store.mts", import.meta.url));

export interface SessionIndexRefreshStats {
  parsed: number;
  reused: number;
  removed: number;
  unstable: number;
}

function createSessionIndexWorker(workerData: Record<string, unknown>): Worker {
  return Reflect.construct(Worker, [
    SESSION_INDEX_WORKER_PATH,
    { execArgv: ["--experimental-strip-types"], workerData },
  ]) as Worker;
}

export interface SessionIndexWorkerOptions {
  indexPath: string;
  paths?: string[];
  previousEntries?: ReadonlyMap<string, SessionIndexEntry>;
  projectionVersion: string;
  sessionsDirectory: string;
  onSnapshot?: (entries: Map<string, SessionIndexEntry>) => void;
}

interface WorkerMessage {
  type: "snapshot" | "reconciled" | "persisted" | "error";
  entries?: Array<[string, SessionIndexEntry]>;
  stats?: SessionIndexRefreshStats;
  code?: string;
}

export function runSessionIndexWorker(
  options: SessionIndexWorkerOptions,
): Promise<{ entries: Map<string, SessionIndexEntry>; stats: SessionIndexRefreshStats }> {
  return new Promise((resolve, reject) => {
    const worker = createSessionIndexWorker({
      action: "refresh",
      coreModulePath: SESSION_INDEX_CORE_PATH,
      indexPath: options.indexPath,
      paths: options.paths,
      previousEntries: options.previousEntries
        ? [...options.previousEntries.entries()]
        : undefined,
      projectionVersion: options.projectionVersion,
      sessionsDirectory: options.sessionsDirectory,
      storeModulePath: SESSION_INDEX_STORE_PATH,
    });
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Session index worker failed"));
    };
    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      if (message.type === "snapshot" && message.entries) {
        options.onSnapshot?.(new Map(message.entries));
        return;
      }
      if (message.type === "reconciled" && message.entries && message.stats) {
        settled = true;
        resolve({ entries: new Map(message.entries), stats: message.stats });
        return;
      }
      if (message.type === "error") fail();
    });
    worker.once("error", fail);
    worker.once("exit", (code) => {
      if (!settled && code !== 0) fail();
      else if (!settled) fail();
    });
  });
}

export function persistSessionIndexInWorker(
  options: Pick<SessionIndexWorkerOptions, "indexPath" | "projectionVersion">,
  entries: ReadonlyMap<string, SessionIndexEntry>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = createSessionIndexWorker({
      action: "persist",
      entries: [...entries.entries()],
      indexPath: options.indexPath,
      projectionVersion: options.projectionVersion,
      storeModulePath: SESSION_INDEX_STORE_PATH,
    });
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Session index persistence worker failed"));
    };
    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      if (message.type === "persisted") {
        settled = true;
        resolve();
      } else if (message.type === "error") {
        fail();
      }
    });
    worker.once("error", fail);
    worker.once("exit", () => {
      if (!settled) fail();
    });
  });
}
