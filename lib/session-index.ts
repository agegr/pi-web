import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { SessionIndexCoordinator } from "./session-index-coordinator";
import { indexedSessionMetadata, type IndexedSessionMetadata, type SessionIndexEntry } from "./session-index-core.mts";
import { defaultSessionIndexPath } from "./session-index-store.mts";
import {
  persistSessionIndexInWorker,
  runSessionIndexWorker,
} from "./session-index-worker-client";

export const SESSION_INDEX_PROJECTION_VERSION = "pi-web-session-list-v2-sdk-0.85.1";
const SESSION_INDEX_COORDINATOR_VERSION = 10;
const SESSION_INDEX_BACKGROUND_INTERVAL_MS = 30_000;

interface GlobalSessionIndexState {
  version: number;
  coordinator: SessionIndexCoordinator;
  backgroundValidation?: Promise<void>;
  nextBackgroundValidationAt?: number;
}

declare global {
  var __piSessionIndexState: GlobalSessionIndexState | undefined;
}

export function createSessionIndexCoordinator(
  agentDirectory: string,
  onSnapshotChanged?: () => void,
): SessionIndexCoordinator {
  const indexPath = defaultSessionIndexPath(agentDirectory);
  const sessionsDirectory = join(agentDirectory, "sessions");
  return new SessionIndexCoordinator(
    (onSnapshot, request) => runSessionIndexWorker({
      indexPath,
      paths: request.paths,
      previousEntries: request.previousEntries,
      projectionVersion: SESSION_INDEX_PROJECTION_VERSION,
      sessionsDirectory,
      onSnapshot,
    }),
    (entries) => persistSessionIndexInWorker({
      indexPath,
      projectionVersion: SESSION_INDEX_PROJECTION_VERSION,
    }, entries),
    SESSION_INDEX_BACKGROUND_INTERVAL_MS,
    onSnapshotChanged,
  );
}

function getCoordinator(): SessionIndexCoordinator {
  const existing = globalThis.__piSessionIndexState;
  if (existing?.version === SESSION_INDEX_COORDINATOR_VERSION) return existing.coordinator;
  const coordinator = createSessionIndexCoordinator(getAgentDir(), () => {
    // A replaced hot-reload coordinator cannot invalidate the current list.
    if (globalThis.__piSessionIndexState?.coordinator !== coordinator) return;
    globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
    globalThis.__piSessionListCache = undefined;
  });
  globalThis.__piSessionIndexState = {
    version: SESSION_INDEX_COORDINATOR_VERSION,
    coordinator,
  };
  return coordinator;
}

/** Visible-tab running polls trigger bounded validation without delaying running IDs. */
export function refreshSessionIndexInBackground(): void {
  const coordinator = getCoordinator();
  const state = globalThis.__piSessionIndexState!;
  if (state.backgroundValidation || Date.now() < (state.nextBackgroundValidationAt ?? 0)) return;
  state.nextBackgroundValidationAt = Date.now() + SESSION_INDEX_BACKGROUND_INTERVAL_MS;
  const pending = coordinator.getVerifiedSnapshotOrRefresh()
    .then(() => undefined)
    .catch(() => {
      // A failed validation is not evidence of removal; keep the last list.
      console.error("[pi-web] 会话索引后台校验失败，将在下次校验周期重试");
    })
    .finally(() => {
      if (state.backgroundValidation === pending) state.backgroundValidation = undefined;
    });
  state.backgroundValidation = pending;
}

export async function getIndexedSessionMetadata(
  options: { force?: boolean } = {},
): Promise<IndexedSessionMetadata[]> {
  const coordinator = getCoordinator();
  const entries = options.force
    ? await coordinator.forceRefresh()
    : await coordinator.getSnapshot();
  return indexedSessionMetadata(entries);
}

export function invalidateSessionIndex(paths?: string[]): void {
  // invalidateSessionListCache already advanced the externally visible version.
  getCoordinator().invalidate(paths, true);
}

export function getVerifiedSessionIndexEntries(): ReadonlyMap<string, SessionIndexEntry> | null {
  return getCoordinator().getVerifiedSnapshot();
}

export async function getVerifiedIndexedSessionMetadata(): Promise<IndexedSessionMetadata[]> {
  return indexedSessionMetadata(await getCoordinator().getVerifiedSnapshotOrRefresh());
}
