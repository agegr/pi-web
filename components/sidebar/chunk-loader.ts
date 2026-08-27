/**
 * Lazy chunk loader for the client bundle. The heavy preview/terminal
 * libraries (CodeMirror, xterm — the editor/terminal stacks, several MB)
 * live in separate build-time bundles (`lib/client-<name>.js`) fetched only
 * on first use of the feature that needs them, so startup downloads/parses
 * only the ~1MB core bundle. (The office stack — Univer / docx-preview /
 * pptx-renderer — is no longer bundled here: Office previews moved to the
 * recommended office plugin, see plugins-viewers.ts.)
 *
 * How a chunk script works (see tsdown.config.ts chunkBundle):
 *
 *   globalThis.__dshChunks__ = globalThis.__dshChunks__ || {};
 *   globalThis.__dshChunks__["terminal"] = (require) => { ...exports };
 *
 * The script registers its factory on a plugin-owned global registry (NOT
 * through window.__ModuleLoader__.load — the module loader's import() only
 * resolves seed words, shell-own modules, registered factories, and boot
 * graph rows; a chunk id is none of those, so resolution would be version-
 * dependent). Materialization is plugin-owned:
 *
 * 1. inject <script src="/sidebar/bundle/<name>.js"> (classic same-origin
 *    script; the official /plugins/<id>/client.js route cannot serve
 *    arbitrary file names, so the plugin's own host route serves the chunks),
 * 2. read the factory from the global registry,
 * 3. call it with a require that resolves the platform externals through
 *    `__DSH_MODULES__.import(spec)` — the seed-word branch, the one part of
 *    the module system that is stable across versions.
 *
 * Caching contract (three layers, each with a failure path):
 * - In-memory: one in-flight promise per chunk, memoized until
 *   {@link resetChunks}; a failed load removes its entry so the next call
 *   retries from scratch. HMR re-activation keeps the resolved exports of
 *   unchanged chunks (ETag revalidation via
 *   {@link revalidateChunksOnReactivate}) — the next lazy open skips the
 *   re-inject / re-execute.
 * - Script execution: each re-execution overwrites the global registry slot
 *   (assignment, never registration) — no "duplicate factory registration"
 *   class of errors; a failed materialization clears the cache so the retry
 *   re-injects and re-executes.
 * - HTTP: the bundle route revalidates every request (`cache-control:
 *   no-cache` + ETag, 304 when unchanged), so page refreshes and HMR
 *   re-activations never re-download a multi-MB chunk that did not change.
 *
 * HMR: each plugin activation calls {@link revalidateChunksOnReactivate},
 * which HEADs every loaded chunk against the bundle route and keeps the
 * in-memory cache for the ones whose ETag is unchanged (a hot-reloaded core
 * bundle therefore does not re-execute multi-MB chunk scripts). Chunk-only
 * source edits still need a manual page refresh (the HMR poll watches only
 * client.js); an edit that does land while a core HMR happens is caught by
 * the ETag comparison on the next activation.
 */
export type ChunkName = 'terminal' | 'editor' | 'mermaid'

/** The module exports a chunk factory provides (namespace-ish record). */
export type ChunkExports = Record<string, unknown>

/** A chunk factory: (require) => exports (the chunk's CJS closure shape). */
type ChunkFactory = (require: (spec: string) => unknown) => ChunkExports

/**
 * The platform externals a chunk bundle may require (mirror of
 * CLIENT_EXTERNALS in tsdown.config.ts — the chunk builds keep these
 * external and the loader resolves them here). A superset is safe: the
 * require only answers what the chunk actually asks for. The shell's static
 * module table seeds React, Cordis, and the UI libraries (primitives/slots);
 * `dsh-client-runtime/client` normalizes onto the runtime package row
 * (stripClientSuffix). dsh-client-web-react / dsh-client-schema-form were
 * dropped in DSH 0.1.0-rc.8 (no rc.8 publish, nothing requires them) — the
 * chunks never asked for them, so they no longer belong here.
 */
export const CHUNK_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  "./ui-primitives",
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Chunk script endpoint served by the plugin host half (src/bundle-route.ts). */
const CHUNK_URL = (name: ChunkName): string => `/sidebar/bundle/${name}.js`

/** Bound on the revalidation HEAD round-trip. A timeout fails open (drop +
 *  re-fetch on the next open) so a stuck bundle route can never wedge lazy
 *  chunk loads behind the revalidation barrier. */
const CHUNK_REVALIDATE_TIMEOUT_MS = 5_000

/**
 * The client module system surface this loader needs to resolve externals.
 * DSH 0.1.0-rc.8 provides it as the `ctx.modules` service (no page global
 * anymore); the plugin injects it at activation via
 * {@link setChunkModuleSystem}. The rc.7-era `window.__DSH_MODULES__` global
 * remains as a fallback so older hosts and the test harness keep working.
 */
export interface ChunkModuleSystem {
  import(specifier: string): Promise<unknown>
}

/** The module system injected by the client half at activation (rc.8+). */
let injectedModuleSystem: ChunkModuleSystem | undefined

/**
 * Plugin-owned page global carrying the injected module system across
 * bundle copies: the lazy chunk bundles (client-editor.js etc.) inline their
 * own chunk-loader instance, and rc.8 no longer exposes the shell module
 * system as a page global — so the core bundle's injection must be visible
 * to the chunk copies through a namespace of our own.
 */
const MODULE_SYSTEM_GLOBAL = '__dshSidebarModuleSystem__'

/**
 * Inject the client module system the chunk externals resolve through.
 * Called by the client half's apply() with `ctx.modules` (rc.8+); pass
 * undefined to clear (tests). Survives {@link resetChunks} — the module
 * system is shell state, not chunk state, and stays live across HMR.
 */
export function setChunkModuleSystem(system: ChunkModuleSystem | undefined): void {
  injectedModuleSystem = system
  const g = globalThis as Record<string, unknown>
  if (system === undefined) delete g[MODULE_SYSTEM_GLOBAL]
  else g[MODULE_SYSTEM_GLOBAL] = system
}

/** Resolve the shell-installed module system (injected, then the plugin
 *  global shared with chunk-bundle copies, then the rc.7 page global). */
function moduleSystem(): ChunkModuleSystem | undefined {
  const g = globalThis as Record<string, unknown>
  return injectedModuleSystem
    ?? g[MODULE_SYSTEM_GLOBAL] as ChunkModuleSystem | undefined
    ?? (g as { __DSH_MODULES__?: ChunkModuleSystem }).__DSH_MODULES__
}

/** The plugin-owned chunk factory registry the chunk scripts populate. */
interface ChunkRegistry {
  [name: string]: ChunkFactory | undefined
}

function chunkRegistry(): ChunkRegistry {
  const g = globalThis as { __dshChunks__?: ChunkRegistry }
  return g.__dshChunks__ ??= {}
}

/** Script-load hook; tests replace it with a stub (the default needs a real DOM + network). */
export type ChunkScriptLoader = (src: string) => Promise<void>

const defaultScriptLoader: ChunkScriptLoader = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script')
  el.async = true
  el.src = src
  el.addEventListener('load', () => {
    el.remove()
    resolve()
  }, { once: true })
  el.addEventListener('error', () => {
    el.remove()
    reject(new Error(`[dsh-better-sidebar] chunk script ${src} failed to load`))
  }, { once: true })
  document.head.append(el)
})

let scriptLoader: ChunkScriptLoader = defaultScriptLoader

/** Test hook: replace the chunk-script loader (pass null to restore the default). */
export function setChunkScriptLoaderForTests(loader: ChunkScriptLoader | null): void {
  scriptLoader = loader ?? defaultScriptLoader
}

/** Test/dev hook: resolve a chunk without fetching a script (e.g. vitest). */
const testLoaders = new Map<ChunkName, () => Promise<ChunkExports>>()
export function registerChunkForTests(name: ChunkName, loader: () => Promise<ChunkExports>): void {
  testLoaders.set(name, loader)
}

/** Memoized externals require, resolved once per page from the seed table. */
let externalsRequire: ((spec: string) => unknown) | undefined

async function buildExternalsRequire(modules: ChunkModuleSystem): Promise<(spec: string) => unknown> {
  if (externalsRequire !== undefined) return externalsRequire
  // Per-spec tolerance: a spec the running DSH version cannot resolve (e.g.
  // the runtime/client exemption row) stays unresolved until a chunk
  // actually requires it — only then it is a loud error.
  const entries = await Promise.all(CHUNK_EXTERNALS.map(async (spec) => {
    try {
      return [spec, await modules.import(spec)] as const
    } catch {
      return [spec, undefined] as const
    }
  }))
  const table = new Map<string, unknown>(entries)
  externalsRequire = (spec: string): unknown => {
    if (!table.has(spec)) {
      // Single quotes: the bundle-consistency scan regexes for require("...")
      // lexical calls — a double-quoted literal here would trip it.
      throw new Error(`[dsh-better-sidebar] chunk require('${spec}') missed the module table`)
    }
    return table.get(spec)
  }
  return externalsRequire
}

/** In-flight/memoized chunk loads; a failure removes its entry so a retry re-fetches. */
const cache = new Map<ChunkName, Promise<ChunkExports>>()

/** Chunk names whose exports are currently cached (loaded successfully). */
const loadedChunks = new Set<ChunkName>()

/** ETags observed for loaded chunks (HEAD revalidation, see
 *  {@link revalidateChunksOnReactivate}). */
const chunkEtags = new Map<ChunkName, string>()

/** Pending revalidation barrier: while set, {@link loadChunk} awaits it
 *  before serving cache (see revalidateChunksOnReactivate). */
let revalidation: Promise<void> | null = null

/** Best-effort ETag capture for revalidation. The script tag itself exposes
 *  no response headers, so after a successful load we HEAD the bundle route
 *  once. Failures (including a stuck route — bounded by the timeout) are
 *  ignored — revalidation then fails open (re-fetch). */
async function recordEtag(name: ChunkName): Promise<void> {
  try {
    const res = await fetch(CHUNK_URL(name), {
      method: 'HEAD',
      cache: 'no-cache',
      signal: AbortSignal.timeout(CHUNK_REVALIDATE_TIMEOUT_MS),
    })
    const etag = res.headers.get('etag')
    if (etag !== null && etag !== '') chunkEtags.set(name, etag)
  } catch {
    chunkEtags.delete(name)
  }
}

/**
 * Load (once) and materialize a lazy chunk, returning its module exports.
 * Concurrent callers share one in-flight load; a failure clears the cache
 * entry so the next call retries (the script re-executes and overwrites its
 * global registry slot — assignments are idempotent).
 * @param name - the chunk to load.
 */
export async function loadChunk(name: ChunkName): Promise<ChunkExports> {
  // Barrier: never serve a cache entry that a pending revalidation is about
  // to inspect — a stale chunk could otherwise render mid-HMR (CR #232 P1).
  if (revalidation !== null) await revalidation
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  let task: Promise<ChunkExports>
  task = (async (): Promise<ChunkExports> => {
    const test = testLoaders.get(name)
    if (test !== undefined) return test()
    const modules = moduleSystem()
    if (modules === undefined) {
      throw new Error(`[dsh-better-sidebar] chunk "${name}": client module system unavailable`)
    }
    await scriptLoader(CHUNK_URL(name))
    const factory = chunkRegistry()[name]
    if (typeof factory !== 'function') {
      throw new Error(`[dsh-better-sidebar] chunk "${name}" script did not register its factory`)
    }
    const require = await buildExternalsRequire(modules)
    const exports = factory(require)
    // Only track production loads whose cache entry survived (a revalidation
    // sweep may have dropped it mid-flight; the caller still gets these
    // exports, they just are not memoized for the next open). Test-registry
    // loads return above and never reach this tracking.
    if (cache.get(name) !== undefined) {
      loadedChunks.add(name)
      void recordEtag(name)
    }
    return exports
  })()
  cache.set(name, task)
  void task.catch(() => {
    cache.delete(name)
    loadedChunks.delete(name)
    chunkEtags.delete(name)
  })
  return task
}

/**
 * Drop all chunk state for a fresh plugin activation (HMR-safe): clear the
 * in-memory cache and any test-registry entries, so the next lazy open
 * re-fetches and re-executes the current chunk scripts (the registry slots
 * are overwritten by the re-execution — no cleanup needed). A pending
 * revalidation barrier is cleared too: it was only guarding the cache reads
 * of the state being dropped, so the next load must not wait on it (the
 * orphaned task still settles and its identity-guarded `finally` no-ops).
 */
export function resetChunks(): void {
  cache.clear()
  loadedChunks.clear()
  chunkEtags.clear()
  testLoaders.clear()
  externalsRequire = undefined
  revalidation = null
}

/**
 * HMR-safe re-activation hook (index.tsx calls this instead of a full
 * reset): keep the resolved exports of every loaded chunk and drop only the
 * ones whose script changed on disk — the bundle route revalidates every
 * request (cache-control: no-cache + ETag), so an unchanged chunk keeps its
 * memory cache and the next lazy open skips the re-inject / re-execute.
 * Fail-open: an unreachable, ETag-less, or timed-out chunk is dropped
 * (re-fetch on next open). Test-registry entries are always cleared
 * (per-test fixtures).
 * A page refresh remains the authoritative reset (the HMR poll watches only
 * client.js; chunk-only edits surface here on the next core re-activation).
 *
 * The returned promise is also a BARRIER for {@link loadChunk}: while a
 * revalidation is pending, every chunk load awaits it before serving cache,
 * so a lazy tab opening mid-revalidation can never render stale exports
 * that the sweep is about to invalidate (CR #232 P1).
 */
export function revalidateChunksOnReactivate(): Promise<void> {
  testLoaders.clear()
  const task = (async (): Promise<void> => {
    // Entries not tracked as production-loaded (test fixtures, orphans) never
    // survive a re-activation — their resolved exports came from per-test
    // stubs, not from the bundle route.
    for (const name of [...cache.keys()]) {
      if (!loadedChunks.has(name)) cache.delete(name)
    }
    if (loadedChunks.size === 0) return
    const stale: ChunkName[] = []
    await Promise.all([...loadedChunks].map(async (name) => {
      try {
        const res = await fetch(CHUNK_URL(name), {
          method: 'HEAD',
          cache: 'no-cache',
          signal: AbortSignal.timeout(CHUNK_REVALIDATE_TIMEOUT_MS),
        })
        const etag = res.headers.get('etag')
        if (etag !== null && etag !== '' && chunkEtags.get(name) === etag) return
      } catch {
        // Fail open below (network errors and timeouts alike).
      }
      stale.push(name)
    }))
    for (const name of stale) {
      cache.delete(name)
      loadedChunks.delete(name)
      chunkEtags.delete(name)
    }
  })()
  revalidation = task
  void task.finally(() => { if (revalidation === task) revalidation = null })
  return task
}
