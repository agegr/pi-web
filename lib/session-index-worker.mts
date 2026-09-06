import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { SessionIndexEntry } from "./session-index-core.mts";

type SessionIndexWorkerInput =
  | {
      action: "refresh";
      coreModulePath: string;
      indexPath: string;
      paths?: string[];
      previousEntries?: Array<[string, SessionIndexEntry]>;
      projectionVersion: string;
      sessionsDirectory: string;
      storeModulePath: string;
    }
  | {
      action: "persist";
      entries: Array<[string, SessionIndexEntry]>;
      storeModulePath: string;
      indexPath: string;
      projectionVersion: string;
    };

type SessionIndexWorkerMessage =
  | { type: "snapshot"; entries: Array<[string, SessionIndexEntry]> }
  | {
      type: "reconciled";
      entries: Array<[string, SessionIndexEntry]>;
      stats: { parsed: number; reused: number; removed: number; unstable: number };
    }
  | { type: "persisted" }
  | { type: "error"; code: "refresh_failed" | "persist_failed" };

const input = workerData as SessionIndexWorkerInput;

async function run(): Promise<void> {
  if (!parentPort) throw new Error("Session index worker requires a parent port");
  if (input.action === "persist") {
    const { persistSessionIndex } = await import(pathToFileURL(input.storeModulePath).href) as typeof import("./session-index-store.mts");
    persistSessionIndex(input.indexPath, input.projectionVersion, new Map(input.entries));
    parentPort.postMessage({ type: "persisted" } satisfies SessionIndexWorkerMessage);
    return;
  }

  const [{ enumerateSessionFiles, reconcileSessionFiles, reconcileSessionPaths }, { loadSessionIndex }] = await Promise.all([
    import(pathToFileURL(input.coreModulePath).href) as Promise<typeof import("./session-index-core.mts")>,
    import(pathToFileURL(input.storeModulePath).href) as Promise<typeof import("./session-index-store.mts")>,
  ]);
  const targeted = Array.isArray(input.paths) && input.previousEntries !== undefined;
  const persisted = targeted
    ? new Map(input.previousEntries)
    : loadSessionIndex(input.indexPath, input.projectionVersion);
  if (!targeted && persisted) {
    parentPort.postMessage({
      type: "snapshot",
      entries: [...persisted.entries()],
    } satisfies SessionIndexWorkerMessage);
  }

  const result = targeted
    ? await reconcileSessionPaths(input.paths!, persisted ?? new Map())
    : await reconcileSessionFiles(
      await enumerateSessionFiles(input.sessionsDirectory),
      persisted ?? new Map(),
    );
  parentPort.postMessage({
    type: "reconciled",
    entries: [...result.entries.entries()],
    stats: {
      parsed: result.parsed,
      reused: result.reused,
      removed: result.removed,
      unstable: result.unstable,
    },
  } satisfies SessionIndexWorkerMessage);
}

void run().catch(() => {
  parentPort?.postMessage({
    type: "error",
    code: input.action === "persist" ? "persist_failed" : "refresh_failed",
  } satisfies SessionIndexWorkerMessage);
});
