/**
 * Lazy chunk view wrapper: mounts a component that lives in a lazy chunk,
 * showing a loading placeholder while the chunk script loads and an error +
 * retry affordance on failure. Used by the built-in tab/viewer descriptors.
 *
 * Contract note: {@link lazyChunkComponent} returns a plain render-prop
 * function — the descriptor contract is `component: (props) => ReactNode`,
 * and the repo renders descriptors BOTH ways: Sidebar calls
 * `descriptor.component(props)` directly, EditorHost renders it via
 * `createElement`. The wrapper function body therefore contains no hooks;
 * all state lives in the inner {@link LazyChunkView} component.
 */
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { loadChunk, type ChunkExports, type ChunkName } from './chunk-loader'
import { t } from './locales'
import css from './sidebar.module.css'

interface LazyChunkViewProps<P> {
  chunk: ChunkName
  /** Module-level-stable selector (an inline lambda would re-trigger the effect). */
  pick: (mod: ChunkExports) => ComponentType<P> | undefined
  props: P
}

function LazyChunkView<P>({ chunk, pick, props }: LazyChunkViewProps<P>): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; Comp: ComponentType<any> }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadChunk(chunk).then((mod) => {
      if (cancelled) return
      const Comp = pick(mod)
      if (Comp === undefined) {
        setState({ status: 'error', message: `[dsh-better-sidebar] chunk "${chunk}" is missing its component` })
        return
      }
      setState({ status: 'ready', Comp })
    }).catch((error: unknown) => {
      if (cancelled) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [chunk, pick, attempt])

  if (state.status === 'loading') {
    return <div className={css.editorPlaceholder}>{t('loading')}</div>
  }
  if (state.status === 'error') {
    return (
      <div className={css.editorError}>
        <span>{state.message}</span>
        <button
          type="button"
          className={css.terminalRetry}
          onClick={() => { setAttempt(current => current + 1) }}
        >
          {t('terminalRetry')}
        </button>
      </div>
    )
  }
  return createElement(state.Comp, props)
}

/**
 * Build a descriptor-compatible lazy wrapper for a chunk-resident component.
 * The returned function is the descriptor `component` itself: it returns an
 * element and never calls hooks, so both invocation styles (plain function
 * call and createElement/JSX render) work. `pick` must be a module-level
 * function (stable identity) — an inline lambda would re-trigger the load
 * effect on every render.
 * @param chunk - the chunk name (see chunk-loader.ts).
 * @param pick - select the component from the chunk's exports.
 */
export function lazyChunkComponent<P extends object>(
  chunk: ChunkName,
  pick: (mod: ChunkExports) => ComponentType<P> | undefined,
): (props: P) => ReactNode {
  return (props: P) => createElement(
    LazyChunkView as ComponentType<LazyChunkViewProps<P>>,
    { chunk, pick, props },
  )
}
