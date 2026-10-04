// One promise chain per key, kept on globalThis under `storeKey`: route
// handlers are bundled separately and hot reload re-evaluates modules, so a
// module-level map would give each copy its own chain. Used by the `mcp.json`
// writer (one chain per file) and by trusting a fresh folder (one per folder);
// each keeps its own `Symbol.for` name, so a process that already holds a
// chain under it keeps using it.

/**
 * Runs `task` after every earlier task for the same key under `storeKey` has
 * settled, whether it resolved or threw. A chain that ran out is removed.
 */
export function serializeByKey<T>(storeKey: symbol, key: string, task: () => Promise<T>): Promise<T> {
  const store = globalThis as Record<symbol, Map<string, Promise<void>> | undefined>;
  const chains = (store[storeKey] ??= new Map());
  const run = (chains.get(key) ?? Promise.resolve()).then(task);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
