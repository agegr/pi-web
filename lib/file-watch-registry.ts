/**
 * Open `GET /api/files/…?type=watch` streams, counted for the debug panel. Server only.
 *
 * Route handlers are bundled into separate module graphs, each with its own copy of this module
 * (see lib/agent-event-stream.ts), so the debug route would see another module-level Set than
 * the files route's. Symbol.for + globalThis shares one.
 */
const FILE_WATCH_REGISTRY: symbol = Symbol.for("pi-web:file-watch-streams");

function fileWatches(): Set<object> | undefined {
  const watches = (globalThis as Record<symbol, unknown>)[FILE_WATCH_REGISTRY];
  return watches instanceof Set ? watches : undefined;
}

/**
 * Counts one open watch stream until the returned release runs. A stream ends either way (its
 * watcher fails, or the client cancels it), so release may run more than once; only the first
 * counts.
 */
export function registerFileWatch(): () => void {
  let watches = fileWatches();
  if (!watches) {
    watches = new Set();
    (globalThis as Record<symbol, unknown>)[FILE_WATCH_REGISTRY] = watches;
  }
  const watch = {};
  watches.add(watch);
  return () => {
    watches.delete(watch);
  };
}

export function countFileWatches(): number {
  return fileWatches()?.size ?? 0;
}
