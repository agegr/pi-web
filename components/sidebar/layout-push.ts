/**
 * Size written to `--dsh-sidebar-width` / `--dsh-sidebar-height`.
 * The conversation column (output + composer) must keep at least
 * {@link PANEL_MIN} of the viewport after the bottom panel claims height.
 */
import { PANEL_MIN } from './state'

export interface LayoutPushInput {
  narrow: boolean
  panelOpen: boolean
  bottomOpen: boolean
  width: number
  bottomHeight: number
  viewportWidth: number
  viewportHeight: number
}

export interface LayoutPushSize {
  width: number
  height: number
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Compute the live layout-push size. Narrow drawers float and push 0. */
export function layoutPushSize(input: LayoutPushInput): LayoutPushSize {
  if (input.narrow) return { width: 0, height: 0 }
  const viewportWidth = finiteNonNegative(input.viewportWidth)
  const viewportHeight = finiteNonNegative(input.viewportHeight)
  const maxHeight = Math.max(0, viewportHeight - Math.min(PANEL_MIN, viewportHeight))
  return {
    width: input.panelOpen ? Math.min(finiteNonNegative(input.width), viewportWidth) : 0,
    height: input.bottomOpen ? Math.min(finiteNonNegative(input.bottomHeight), maxHeight) : 0,
  }
}
